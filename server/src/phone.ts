import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import QRCode from 'qrcode';
import { db, now } from './db.js';
import { env } from './env.js';
import { token } from './lib/ids.js';
import { createSession, isLocalHost, isLoopbackAddress, requireUser, type AuthVars } from './lib/auth.js';

/**
 * Phone remote control. The laptop runs everything; the phone is a browser (installable as an app)
 * that talks to this server over the home network, or over a free Cloudflare quick tunnel the user
 * switches on. Pairing: the laptop shows a QR code holding a one-time link (5 minutes); opening it on
 * the phone signs that phone in. Only the laptop itself (not a paired phone) can pair or remove phones.
 */

const CODE_TTL = 5 * 60_000;
const codes = new Map<string, { userId: string; expires: number }>();

export const pairRoute = new Hono();
export const phoneApi = new Hono<AuthVars>();
phoneApi.use('*', requireUser);

/** Pairing and device management are for the laptop's own screen only. */
phoneApi.use('*', async (c, next) => {
  if (!isLocalHost(c.req.header('host')) || !isLoopbackAddress(getConnInfo(c).remote.address)) return c.json({ error: 'Open Krishbot on the laptop to manage phones.' }, 403);
  await next();
});

function lanUrls(): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push({ label: `Home network (${name})`, url: `http://${i.address}:${env.port}` });
  }
  return out;
}

// ---------- free tunnel (cloudflared quick tunnel: no account) ----------

let tunnel: { proc: ChildProcess; url: string | null; error: string | null } | null = null;

function startTunnel(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(process.env.CLOUDFLARED_BIN || 'cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${env.port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    const t = { proc, url: null as string | null, error: null as string | null };
    tunnel = t;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    proc.stderr!.on('data', (d: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(d.toString());
      if (m && !t.url) { t.url = m[0]; finish(); }
    });
    proc.on('error', (e: NodeJS.ErrnoException) => {
      t.error = e.code === 'ENOENT' ? 'cloudflared is not installed. Install it (free, cloudflare.com/products/tunnel) or stay on the home network.' : e.message;
      finish();
    });
    proc.on('exit', () => { if (tunnel === t) tunnel = null; finish(); });
    setTimeout(() => { if (!t.url && !t.error) { t.error = 'The tunnel did not start in time. Check your internet connection.'; proc.kill(); } finish(); }, 25_000);
  });
}

export const stopTunnel = () => { tunnel?.proc.kill(); tunnel = null; };
process.on('exit', stopTunnel);

const sid = (t: string) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 12);

phoneApi.get('/', (c) => {
  const devices = (db.prepare("SELECT token, device, created_at, last_seen FROM auth_sessions WHERE device IS NOT NULL AND expires_at>? ORDER BY created_at DESC").all(now()) as any[])
    .map((r) => ({ id: sid(r.token), name: r.device, pairedAt: r.created_at, lastSeen: r.last_seen }));
  return c.json({ lan: lanUrls(), tunnel: { on: !!tunnel?.url, url: tunnel?.url ?? null, error: tunnel?.error ?? null }, devices });
});

phoneApi.post('/pair', async (c) => {
  const { via } = await c.req.json<{ via?: 'lan' | 'tunnel' }>().catch(() => ({} as { via?: 'lan' | 'tunnel' }));
  const base = via === 'tunnel' ? tunnel?.url : lanUrls()[0]?.url;
  if (!base) return c.json({ error: via === 'tunnel' ? 'Switch the tunnel on first.' : 'No home network found. Connect this computer to Wi-Fi, or use the tunnel.' }, 400);
  for (const [k, v] of codes) if (v.expires < now()) codes.delete(k);
  const code = token().replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  codes.set(code, { userId: c.get('user').id, expires: now() + CODE_TTL });
  const url = `${base}/pair/${code}`;
  return c.json({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360 }), expiresInSec: CODE_TTL / 1000 });
});

phoneApi.post('/tunnel', async (c) => {
  const { on } = await c.req.json<{ on?: boolean }>().catch(() => ({} as { on?: boolean }));
  if (!on) { stopTunnel(); return c.json({ ok: true }); }
  if (!tunnel) await startTunnel();
  if (tunnel?.error && !tunnel.url) { const error = tunnel.error; stopTunnel(); return c.json({ error }, 400); }
  return c.json({ ok: true, url: tunnel?.url ?? null });
});

phoneApi.delete('/devices/:id', (c) => {
  const id = c.req.param('id');
  for (const r of db.prepare('SELECT token FROM auth_sessions WHERE device IS NOT NULL').all() as { token: string }[]) {
    if (sid(r.token) === id) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(r.token);
  }
  return c.json({ ok: true });
});

// ---------- the link the phone opens ----------

const deviceName = (ua: string) => {
  const m = /\(([^)]*)\)/.exec(ua)?.[1] ?? '';
  const os_ = /iPhone|iPad/.test(m) ? 'iPhone' : /Android/.test(m) ? (/Android[^;]*;\s*([^;)]+)/.exec(m)?.[1]?.trim() || 'Android phone') : /Mac/.test(m) ? 'Mac' : /Windows/.test(m) ? 'Windows PC' : 'Phone';
  return os_.slice(0, 40);
};

pairRoute.get('/:code', (c) => {
  const code = c.req.param('code');
  const hit = codes.get(code);
  codes.delete(code);
  if (!hit || hit.expires < now()) return c.html('<meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center"><h3>This pairing link was already used or has expired.</h3><p>On the laptop: Settings → Phone → Pair a phone.</p>', 410);
  createSession(c, hit.userId, deviceName(c.req.header('user-agent') ?? ''));
  return c.redirect('/');
});
