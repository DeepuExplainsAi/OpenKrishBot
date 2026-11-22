import { db, now } from './db.js';

/** Paperclip-style budget, in tokens (most models here are free): usage per bot per day, with an optional daily cap per bot. */
db.exec(`CREATE TABLE IF NOT EXISTS usage_daily (
  bot_id TEXT NOT NULL, day TEXT NOT NULL, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, day)
)`);

const day = (t = now()) => new Date(t).toISOString().slice(0, 10);
/** ~4 characters per token, used when the provider does not report usage. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

export function recordUsage(botId: string, tokensIn: number, tokensOut: number, t = now()) {
  db.prepare(`INSERT INTO usage_daily(bot_id,day,tokens_in,tokens_out,calls) VALUES (?,?,?,?,1)
    ON CONFLICT(bot_id,day) DO UPDATE SET tokens_in=tokens_in+excluded.tokens_in, tokens_out=tokens_out+excluded.tokens_out, calls=calls+1`).run(botId, day(t), Math.max(0, Math.round(tokensIn)), Math.max(0, Math.round(tokensOut)));
}

export function usageToday(botId: string, t = now()) {
  const r = db.prepare('SELECT tokens_in, tokens_out, calls FROM usage_daily WHERE bot_id=? AND day=?').get(botId, day(t)) as any;
  return { tokensIn: r?.tokens_in ?? 0, tokensOut: r?.tokens_out ?? 0, calls: r?.calls ?? 0 };
}

export const getBudget = (botId: string): number | null => {
  const v = (db.prepare('SELECT value FROM kv WHERE key=?').get(`budget:${botId}`) as any)?.value;
  return v ? Number(v) : null;
};
export function setBudget(botId: string, tokens: number | null) {
  if (tokens === null || !(tokens > 0)) db.prepare('DELETE FROM kv WHERE key=?').run(`budget:${botId}`);
  else db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(`budget:${botId}`, String(Math.round(tokens)));
}

/** A message to show instead of calling the model, when the bot has used up today's budget. */
export function overBudget(botId: string, t = now()): string | null {
  const cap = getBudget(botId);
  if (!cap) return null;
  const u = usageToday(botId, t);
  return u.tokensIn + u.tokensOut >= cap ? `This Bot reached its daily limit of ${cap.toLocaleString()} tokens. Raise or remove the limit in its Engine settings, or wait for the next UTC day (midnight UTC).` : null;
}

export const usageSummary = (userId: string, days = 7) =>
  db.prepare(`SELECT u.bot_id botId, b.name, SUM(u.tokens_in) tokensIn, SUM(u.tokens_out) tokensOut, SUM(u.calls) calls
    FROM usage_daily u JOIN bots b ON b.id=u.bot_id WHERE b.user_id=? AND u.day>=? GROUP BY u.bot_id ORDER BY SUM(u.tokens_in+u.tokens_out) DESC`)
    .all(userId, day(now() - (days - 1) * 86_400_000)) as { botId: string; name: string; tokensIn: number; tokensOut: number; calls: number }[];
