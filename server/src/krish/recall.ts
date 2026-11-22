import { db } from '../db.js';

/** Search a bot's older chat messages by meaning-ish keywords (mem0-style recall without embeddings): rarer words weigh more. */
const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

export function rank(docs: { text: string; at: number }[], query: string, limit = 5) {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  const sets = docs.map((d) => new Set(words(d.text)));
  const weight = (w: string) => Math.log(1 + docs.length / (1 + sets.filter((s) => s.has(w)).length));
  return docs
    .map((d, i) => ({ ...d, score: q.reduce((n, w) => n + (sets[i].has(w) ? weight(w) : 0), 0) }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, limit);
}

export function recall(botId: string, query: string, limit = 5): string {
  const rows = db.prepare(`SELECT body, created_at FROM rows WHERE bot_id=? AND kind='message' ORDER BY created_at DESC LIMIT 5000`).all(botId) as { body: string; created_at: number }[];
  const docs = rows.flatMap((r) => { try { const b = JSON.parse(r.body); return b.text ? [{ text: `${b.role === 'user' ? 'User' : 'You'}: ${b.text}`, at: r.created_at }] : []; } catch { return []; } });
  const hits = rank(docs, query, limit);
  return hits.length ? hits.map((h) => `[${new Date(h.at).toISOString().slice(0, 10)}] ${h.text.slice(0, 600)}`).join('\n\n') : 'Nothing found in older chats.';
}
