import type { Row } from './types.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One conversation as a single offline HTML page (read-only snapshot, no scripts, no links back to this computer). Secrets typed into the chat are the user's to check before sending. */
export function conversationHtml(botName: string, rows: Row[], when = new Date()): string {
  const msgs = rows.flatMap((r) => (r.body.type === 'message' && r.body.text.trim() ? [{ role: r.body.role, text: r.body.text }] : []));
  const body = msgs.map((m) => `<section class="${m.role}"><b>${m.role === 'user' ? 'You' : esc(botName)}</b><pre>${esc(m.text)}</pre></section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(botName)}: shared conversation</title>
<style>body{font:15px/1.55 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#1a1a1a;background:#fafafa}h1{font-size:18px;margin:0 0 4px}small{color:#777}
section{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid #e5e5e5}section.user{background:#eef3ff}pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:6px 0 0}</style></head>
<body><h1>${esc(botName)}</h1><small>Shared from OpenKrishBot on ${esc(when.toISOString().slice(0, 10))}. Read-only copy, ${msgs.length} messages.</small>
${body || '<p>No messages yet.</p>'}</body></html>`;
}
