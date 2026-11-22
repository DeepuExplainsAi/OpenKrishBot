import crypto from 'node:crypto';
import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { db, now } from './db.js';
import { enqueue, isBotBusy } from './agent/loop.js';
import { isLoopbackAddress, isLocalHost } from './lib/auth.js';
import { appendRow, getBotRow, listRows } from './store.js';

/**
 * Local scripts API: a program on this computer sends a bot a message and reads its answer, e.g.
 *   curl -H "Authorization: Bearer $TOKEN" -d '{"text":"run the tests"}' http://127.0.0.1:8787/script/bots/Ada/messages
 * Off by default, one token per bot (turn it on in the bot's settings), loopback only, token stored hashed.
 */
db.exec('CREATE TABLE IF NOT EXISTS script_tokens (bot_id TEXT PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER NOT NULL)');

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function enableScripts(botId: string): string {
  const token = `okb_${crypto.randomBytes(24).toString('hex')}`;
  db.prepare('INSERT OR REPLACE INTO script_tokens(bot_id,hash,created_at) VALUES (?,?,?)').run(botId, hash(token), now());
  return token;
}
export const disableScripts = (botId: string) => { db.prepare('DELETE FROM script_tokens WHERE bot_id=?').run(botId); };
export const scriptsEnabled = (botId: string) => !!db.prepare('SELECT 1 FROM script_tokens WHERE bot_id=?').get(botId);

/** The bot this bearer token belongs to, or null. */
export function botForToken(token: string): string | null {
  const row = db.prepare('SELECT bot_id FROM script_tokens WHERE hash=?').get(hash(token)) as any;
  return row?.bot_id ?? null;
}

export const scriptApi = new Hono();

scriptApi.use('*', async (c, next) => {
  if (!isLocalHost(c.req.header('host')) || !isLoopbackAddress(getConnInfo(c).remote.address)) return c.json({ error: 'Local scripts only.' }, 403);
  const m = /^Bearer (okb_[0-9a-f]+)$/.exec(c.req.header('authorization') ?? '');
  const botId = m ? botForToken(m[1]) : null;
  if (!botId) return c.json({ error: 'Missing or wrong token. Turn on Local scripts in the bot\'s settings.' }, 401);
  c.set('botId' as never, botId as never);
  await next();
});

const lastAnswer = (botId: string, afterSeq: number) => {
  const rows = listRows(botId, { limit: 200 }).filter((r) => r.seq > afterSeq && r.body.type === 'message' && (r.body as any).role === 'assistant' && !(r.body as any).streaming);
  return rows.length ? String((rows[rows.length - 1].body as any).text ?? '') : null;
};

/** POST /script/messages { text, wait?: seconds } -> queues the message; with wait, returns the answer when the turn ends. */
scriptApi.post('/messages', async (c) => {
  const botId = c.get('botId' as never) as string;
  const { text, wait } = await c.req.json<{ text?: unknown; wait?: unknown }>().catch(() => ({} as any));
  if (typeof text !== 'string' || !text.trim()) return c.json({ error: 'text is required' }, 400);
  if (text.length > 60_000) return c.json({ error: 'message too long (max 60000 characters)' }, 413);
  const row = appendRow(botId, 'message', { type: 'message', role: 'user', text: text.trim() });
  enqueue(botId, { type: 'user', text: text.trim() });
  const limit = Math.min(Number(wait) || 0, 3600) * 1000;
  if (!limit) return c.json({ ok: true, seq: row.seq });
  const end = Date.now() + limit;
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() < end && isBotBusy(botId)) await new Promise((r) => setTimeout(r, 500));
  if (isBotBusy(botId)) return c.json({ ok: true, seq: row.seq, done: false }, 202);
  return c.json({ ok: true, seq: row.seq, done: true, answer: lastAnswer(botId, row.seq) });
});

scriptApi.get('/status', (c) => {
  const botId = c.get('botId' as never) as string;
  return c.json({ name: getBotRow(botId)?.name, busy: isBotBusy(botId) });
});
