import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

/** A bot's own Chrome on this computer, driven over the DevTools protocol. No X server, no VNC, no cloud. */

export const SCREEN_W = 1280;
export const SCREEN_H = 800;

export function findChrome(): string | null {
  const env = process.env.CHROME_PATH;
  const candidates = [
    env,
    '/opt/agent-browser/chrome/chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

const CDP_TIMEOUT_MS = 30_000;

export class Cdp {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Set<(p: any, sessionId?: string) => void>>();
  closed = false;

  static async connect(url: string): Promise<Cdp> {
    const c = new Cdp();
    c.ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((res, rej) => { c.ws.once('open', () => res()); c.ws.once('error', rej); });
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.id) {
        const p = c.pending.get(m.id); c.pending.delete(m.id);
        if (p) m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method) c.listeners.get(m.method)?.forEach((f) => f(m.params, m.sessionId));
    });
    c.ws.on('close', () => { c.closed = true; for (const p of c.pending.values()) p.reject(new Error('browser closed')); c.pending.clear(); c.listeners.get('closed')?.forEach((f) => f({})); });
    return c;
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error('browser closed'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser did not answer ${method} in ${CDP_TIMEOUT_MS / 1000}s`)); }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(event: string, fn: (p: any, sessionId?: string) => void): () => void {
    let s = this.listeners.get(event);
    if (!s) this.listeners.set(event, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }

  close() { try { this.ws.close(); } catch { /* */ } }
}

export interface Running { proc: ChildProcess; cdp: Cdp; port: number; profile: string }

/** Start Chrome for one bot with its own profile (logins stay between runs). */
export async function launch(profileDir: string): Promise<Running> {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome or Chromium is not installed. Install Google Chrome (or set CHROME_PATH) so the bot can use a browser.');
  fs.mkdirSync(profileDir, { recursive: true });
  const headless = process.env.KRISH_HEADFUL === '1' ? [] : ['--headless=new'];
  const args = [
    ...headless, '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, `--window-size=${SCREEN_W},${SCREEN_H}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-sync',
    '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars',
    ...(process.getuid?.() === 0 || process.env.KRISH_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chrome did not start in time.')), 20000);
    proc.stderr!.on('data', (d) => {
      buf += String(d);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.once('exit', (code) => { clearTimeout(t); reject(new Error(`Chrome exited (${code}) before it was ready.`)); });
    proc.once('error', (e) => { clearTimeout(t); reject(e); });
  });
  const cdp = await Cdp.connect(wsUrl);
  return { proc, cdp, port: Number(new URL(wsUrl).port), profile: profileDir };
}

export const profileDirFor = (botId: string) => path.join(os.homedir(), '.openkrishbot', 'profiles', botId);
