import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from './db.js';
import { hub } from './lib/hub.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { enqueue, interrupt, resolveApproval } from './agent/loop.js';
import { appendRow } from './store.js';
import { chunk, createRelay, MARK } from './whatsapp-relay.js';

/**
 * Telegram for the main Bot, on this computer only: you make a bot with @BotFather, paste its token in Settings, and
 * OpenKrishBot long-polls Telegram (no webhook, no server). A chat can command the Bot only after it sends "/pair <code>"
 * with the one-time code shown in Settings. Same relay as WhatsApp: replies, approval cards (reply 1/2/3) and errors.
 */

const API = process.env.KRISH_TELEGRAM_API ?? 'https://api.telegram.org';
const get = (k: string) => (db.prepare('SELECT value FROM kv WHERE key=?').get(`tg_${k}`) as any)?.value as string | undefined;
const put = (k: string, v: string) => db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(`tg_${k}`, v);
const del = (k: string) => db.prepare('DELETE FROM kv WHERE key=?').run(`tg_${k}`);
const allowList = (): string[] => { try { return JSON.parse(get('allow') ?? '[]'); } catch { return []; } };

export interface Update { update_id: number; message?: { chat: { id: number; type: string }; text?: string } }

/** Decide what an incoming update means. Pure so it can be tested: pairing, access, then hand to the relay. */
export function handleUpdate(u: Update, o: { pairCode: string | null; allow: string[]; pair(chat: string): void; reply(chat: string, text: string): Promise<void>; relay(chat: string, text: string): Promise<void> }): Promise<void> {
  const m = u.message;
  if (!m?.text || m.chat.type !== 'private') return Promise.resolve();
  const chat = String(m.chat.id);
  const text = m.text.trim();
  const pair = /^\/pair\s+(\S+)$/i.exec(text);
  if (pair) {
    if (o.pairCode && pair[1] === o.pairCode) { o.pair(chat); return o.reply(chat, 'Paired. You can talk to OpenKrishBot here now.'); }
    return o.reply(chat, 'Wrong or expired code.');
  }
  if (!o.allow.includes(chat)) return /^\/start/i.test(text) ? o.reply(chat, 'This OpenKrishBot is private. Send /pair <code> with the code from Settings → Telegram.') : Promise.resolve();
  return o.relay(chat, text);
}

let token: string | null = null;
let status: 'off' | 'running' | 'error' = 'off';
let botName: string | null = null;
let lastError: string | null = null;
let abort: AbortController | null = null;
let stopRow: (() => void) | null = null;
let pairCode: string | null = null;
let pairCodeAt = 0;
const PAIR_TTL_MS = 10 * 60_000;
const livePairCode = () => (pairCode && Date.now() - pairCodeAt < PAIR_TTL_MS ? pairCode : null);

const call = async (method: string, body: object, signal?: AbortSignal) => {
  const r = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description ?? `Telegram error ${r.status}`), { code: j.error_code ?? r.status, retryAfter: Number(j.parameters?.retry_after) || 0 });
  return j.result;
};
/** One message part; Telegram's 429 says how long to wait, so wait that long (max 3 tries) instead of dropping the reply. */
async function sendPart(chat: string, text: string) {
  for (let tryNo = 0; ; tryNo++) {
    try { return await call('sendMessage', { chat_id: chat, text }); }
    catch (e: any) {
      if (e.code !== 429 || tryNo >= 2) throw e;
      await new Promise((r) => setTimeout(r, Math.min((e.retryAfter || 2) * 1000, 30_000)));
    }
  }
}
const sendText = async (chat: string, text: string) => { for (const part of chunk(text.replaceAll(MARK, ''), 3500)) await sendPart(chat, part); };

function primaryBot(): { id: string; user_id: string } | null {
  return (db.prepare("SELECT id, user_id FROM bots WHERE engine='primary' LIMIT 1").get() as any) ?? null;
}

async function start() {
  token = get('token') ?? null;
  const bot = primaryBot();
  if (!token) { status = 'error'; lastError = 'Paste a bot token first.'; return; }
  if (!bot) { status = 'error'; lastError = 'No main Bot yet.'; return; }
  abort?.abort();
  const ctl = abort = new AbortController();
  try { botName = (await call('getMe', {}, ctl.signal)).username; } catch (e: any) { status = 'error'; lastError = e.code === 401 ? 'Telegram rejected this token.' : `Cannot reach Telegram: ${e.message}`; return; }
  status = 'running'; lastError = null;

  const relay = createRelay({
    botId: bot.id,
    allowed: (chat) => allowList().includes(chat),
    send: sendText,
    say: (text) => { appendRow(bot.id, 'message', { type: 'message', role: 'user', text }); enqueue(bot.id, { type: 'user', text }); },
    interrupt: () => interrupt(bot.id),
    pendingApproval: () => (db.prepare("SELECT id FROM approvals WHERE bot_id=? AND status='pending' ORDER BY rowid DESC LIMIT 1").get(bot.id) as any)?.id ?? null,
    answerApproval: (id, decision) => { try { resolveApproval(bot.user_id, id, decision); } catch { /* already answered */ } },
  });
  stopRow?.();
  stopRow = hub.subscribe(bot.user_id, (ev) => { if (ev.type === 'rows' && ev.botId === bot.id) for (const r of ev.rows) relay.onRow(r).catch((e) => console.error('[telegram] send failed', e?.message)); });

  let offset = Number(get('offset') ?? 0);
  let wait = 1000;
  void (async () => {
    while (!ctl.signal.aborted) {
      try {
        const updates: Update[] = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, ctl.signal);
        wait = 1000; status = 'running'; lastError = null;
        for (const u of updates) {
          offset = u.update_id + 1; put('offset', String(offset));
          await handleUpdate(u, {
            pairCode: livePairCode(), allow: allowList(),
            pair: (chat) => { put('allow', JSON.stringify([...new Set([...allowList(), chat])])); pairCode = null; },
            reply: sendText,
            relay: (chat, text) => relay.onMessage(chat, text, false, false),
          }).catch((e) => console.error('[telegram]', e?.message));
        }
      } catch (e: any) {
        if (ctl.signal.aborted) return;
        if (e.code === 401) { status = 'error'; lastError = 'Telegram rejected this token.'; return; }
        status = 'error';
        if (e.code === 409) { lastError = 'Another program is already reading this bot (same token on another computer or app). Stop it there; retrying…'; wait = Math.max(wait, 10_000); }
        else if (e.code === 429 && e.retryAfter) { lastError = `Telegram asked to slow down, waiting ${e.retryAfter}s.`; wait = e.retryAfter * 1000; }
        else lastError = `Connection problem, retrying: ${e.message}`;
        await new Promise((r) => setTimeout(r, wait)); wait = Math.min(wait * 2, 60_000);
      }
    }
  })();
}

function stop() { abort?.abort(); abort = null; stopRow?.(); stopRow = null; status = 'off'; }

export function initTelegram() { if (get('on') === '1') start().catch((e) => { status = 'error'; lastError = String(e?.message ?? e); }); }

export const telegramApi = new Hono<AuthVars>();
telegramApi.use('*', requireUser);
telegramApi.get('/', (c) => c.json({ status, bot: botName, error: lastError, hasToken: !!get('token'), paired: allowList().length, pairCode: livePairCode() }));
telegramApi.put('/token', async (c) => {
  const { token: t } = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  if (!/^\d{6,12}:[\w-]{30,}$/.test(String(t ?? '').trim())) return c.json({ error: 'That does not look like a BotFather token (like 123456:ABC-…).' }, 400);
  put('token', String(t).trim()); put('on', '1'); del('offset');
  await start();
  return c.json({ status, bot: botName, error: lastError });
});
telegramApi.post('/pair-code', (c) => { pairCode = crypto.randomInt(100000, 999999).toString(); pairCodeAt = Date.now(); return c.json({ pairCode }); });
telegramApi.post('/start', async (c) => { put('on', '1'); await start(); return c.json({ status, bot: botName, error: lastError }); });
telegramApi.post('/stop', (c) => { put('on', '0'); stop(); return c.json({ ok: true }); });
telegramApi.post('/unlink', (c) => { stop(); for (const k of ['token', 'on', 'allow', 'offset']) del(k); botName = null; return c.json({ ok: true }); });
