import { estimateTokens } from '../usage.js';

/** Long chats: when the history gets big, the older part is replaced by a short summary so the model keeps the thread. */
export type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | any[] | null; tool_calls?: any[]; tool_call_id?: string };

export const COMPACT_AT_TOKENS = Number(process.env.OPENKRISHBOT_COMPACT_TOKENS) || 20_000;
const KEEP_RECENT = 12;
const SUMMARY_MARK = '[Summary of the earlier conversation]';

const size = (m: Msg) => (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length) + JSON.stringify(m.tool_calls ?? '').length;
export const historyTokens = (h: Msg[], systemChars = 0) => estimateTokens(systemChars + h.reduce((n, m) => n + size(m), 0));

/** Start index of the part to keep: always a user message, so a tool result never loses the assistant call it answers. */
export function safeStart(h: Msg[], want: number): number {
  let i = Math.max(0, h.length - want);
  while (i < h.length && h[i].role !== 'user') i++;
  return i < h.length ? i : Math.max(0, h.length - want);
}

/** Last `want` messages, cut at a user message (what gets sent to the model). */
export const recentWindow = <T extends Msg>(h: T[], want: number): T[] => h.slice(safeStart(h, want));

const asText = (h: Msg[]) => h.map((m) => {
  const body = typeof m.content === 'string' ? m.content : m.content ? '[attachment]' : '';
  return `${m.role}${m.tool_calls ? ' (called tools)' : ''}: ${body.slice(0, 1500)}`;
}).join('\n');

/** Replaces the old part of `h` (in place) with one summary message. Returns false when nothing was done. */
export async function compactHistory(h: Msg[], systemChars: number, summarize: (transcript: string) => Promise<string>): Promise<boolean> {
  if (historyTokens(h, systemChars) < COMPACT_AT_TOKENS) return false;
  const cut = safeStart(h, KEEP_RECENT);
  if (cut < 4) return false;
  const old = h.slice(0, cut);
  let summary = '';
  try { summary = (await summarize(asText(old))).trim(); } catch { return false; }
  if (!summary) return false;
  h.splice(0, cut, { role: 'user', content: `${SUMMARY_MARK}\n${summary}` });
  return true;
}

export const SUMMARY_PROMPT = 'Summarise this conversation so work can continue from it. Keep: the user\'s goal, decisions made, facts and names found, files and links, what is done and what is still open. Be short and concrete. Reply with the summary only.';
