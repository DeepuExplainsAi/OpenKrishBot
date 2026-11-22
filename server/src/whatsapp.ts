import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import QRCode from 'qrcode';
import { db } from './db.js';
import { hub } from './lib/hub.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { enqueue, interrupt, resolveApproval } from './agent/loop.js';
import { appendRow } from './store.js';
import { chunk, createRelay, digits, MARK } from './whatsapp-relay.js';

/**
 * WhatsApp for the main Bot, on this computer only: OpenKrishbot links as a WhatsApp Web device (scan a QR code in
 * Settings → WhatsApp) with Baileys. You command the Bot from your own "Message yourself" chat; other numbers
 * work only if you add them to the allowed list. Replies and approval questions come back as WhatsApp messages.
 * This is an unofficial client: WhatsApp may restrict accounts that automate heavily, so use a number you can afford to lose.
 */

const AUTH_DIR = path.join(os.homedir(), '.krishbot', 'whatsapp');

type Status = 'off' | 'starting' | 'qr' | 'connected' | 'error';
let status: Status = 'off';
let qr: string | null = null;
let me: string | null = null;
let lastError: string | null = null;
let sock: any = null;
let stopRow: (() => void) | null = null;
let wanted = false;
let retry = 0;

const setting = (k: string) => (db.prepare('SELECT value FROM kv WHERE key=?').get(`wa_${k}`) as any)?.value as string | undefined;
const setSetting = (k: string, v: string) => db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(`wa_${k}`, v);
const allowList = (): string[] => { try { return JSON.parse(setting('allow') ?? '[]'); } catch { return []; } };

function primaryBot(): { id: string; user_id: string } | null {
  return (db.prepare("SELECT id, user_id FROM bots WHERE engine='primary' LIMIT 1").get() as any) ?? null;
}

async function start() {
  const bot = primaryBot();
  if (!bot) { status = 'error'; lastError = 'No main Bot yet.'; return; }
  wanted = true; status = 'starting'; lastError = null;
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = await fetchLatestBaileysVersion().then((v) => v.version).catch(() => undefined);
  const s = makeWASocket({ auth: state, version, browser: Browsers.macOS('OpenKrishbot'), syncFullHistory: false, markOnlineOnConnect: false, logger: silent() });
  sock = s;

  const relay = createRelay({
    botId: bot.id,
    allowed: (jid, fromMe, isSelfChat) => (fromMe ? isSelfChat : allowList().includes(digits(jid))),
    send: async (jid, text) => { for (const part of chunk(text)) await s.sendMessage(jid, { text: part }); },
    say: (text) => { appendRow(bot.id, 'message', { type: 'message', role: 'user', text }); enqueue(bot.id, { type: 'user', text }); },
    interrupt: () => interrupt(bot.id),
    pendingApproval: () => (db.prepare("SELECT id FROM approvals WHERE bot_id=? AND status='pending' ORDER BY rowid DESC LIMIT 1").get(bot.id) as any)?.id ?? null,
    answerApproval: (id, decision) => { try { resolveApproval(bot.user_id, id, decision); } catch { /* already answered */ } },
  });
  stopRow?.();
  stopRow = hub.subscribe(bot.user_id, (ev) => { if (ev.type === 'rows' && ev.botId === bot.id) for (const r of ev.rows) relay.onRow(r).catch((e) => console.error('[whatsapp] send failed', e?.message)); });

  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async (u: any) => {
    if (u.qr) { status = 'qr'; qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 300 }); }
    if (u.connection === 'open') { status = 'connected'; qr = null; retry = 0; me = digits(s.user?.id ?? ''); lastError = null; }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      sock = null; qr = null; me = null;
      if (code === DisconnectReason.loggedOut) { wanted = false; status = 'off'; await unlink(); return; }
      if (!wanted) { status = 'off'; return; }
      // lost connection: reconnect with growing pauses (2s, 4s … up to 60s)
      status = 'starting'; lastError = 'Connection lost, reconnecting…';
      setTimeout(() => { if (wanted) start().catch(fail); }, Math.min(2000 * 2 ** retry++, 60_000));
    }
  });
  s.ev.on('messages.upsert', ({ messages, type }: any) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const jid: string = m.key.remoteJid ?? '';
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
      const text: string = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '';
      const selfChat = !!me && digits(jid) === me;
      relay.onMessage(jid, text, !!m.key.fromMe, selfChat).catch((e) => console.error('[whatsapp]', e?.message));
    }
  });
}

const silent = () => ({ level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} }) as any;
const fail = (e: any) => { status = 'error'; lastError = String(e?.message ?? e); };

async function stop() {
  wanted = false; stopRow?.(); stopRow = null;
  try { sock?.end(undefined); } catch { /* closed */ }
  sock = null; qr = null; me = null; status = 'off';
}

async function unlink() {
  await stop();
  const fs = await import('node:fs/promises');
  await fs.rm(AUTH_DIR, { recursive: true, force: true });
  setSetting('on', '0');
}

/** On server start: reconnect if it was on and a session exists. */
export function initWhatsApp() {
  if (setting('on') === '1') start().catch(fail);
}

export const whatsappApi = new Hono<AuthVars>();
whatsappApi.use('*', requireUser);

whatsappApi.get('/', (c) => c.json({ status, qr, me, error: lastError, allow: allowList(), marker: MARK.length }));

whatsappApi.post('/start', async (c) => { setSetting('on', '1'); if (!sock) await start().catch(fail); return c.json({ ok: true, status }); });
whatsappApi.post('/stop', async (c) => { setSetting('on', '0'); await stop(); return c.json({ ok: true }); });
whatsappApi.post('/unlink', async (c) => { await unlink(); return c.json({ ok: true }); });
whatsappApi.put('/allow', async (c) => {
  const { numbers } = await c.req.json<{ numbers: string[] }>();
  setSetting('allow', JSON.stringify([...new Set((numbers ?? []).map(digits).filter((n) => n.length >= 8))]));
  return c.json({ ok: true, allow: allowList() });
});
