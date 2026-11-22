import test from 'node:test';
import assert from 'node:assert/strict';
const { conversationHtml } = await import('../src/share.js');
const row = (role: 'user' | 'assistant', text: string) => ({ botId: 'b', generation: 1, seq: 1, updatedSeq: 1, kind: 'message', body: { type: 'message', role, text }, createdAt: 1 }) as any;

test('conversationHtml escapes HTML, keeps order, names the bot, drops non-messages', () => {
  const h = conversationHtml('Krish <Bot>', [row('user', '<script>alert(1)</script>'), { ...row('user', 'x'), kind: 'event', body: { type: 'event', text: 'e' } }, row('assistant', 'Done & dusted')], new Date('2026-11-22'));
  assert.ok(!h.includes('<script>'));
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(h, /Krish &lt;Bot&gt;/);
  assert.match(h, /Done &amp; dusted/);
  assert.match(h, /2026-11-22\. Read-only copy, 2 messages/);
  assert.ok(h.indexOf('alert') < h.indexOf('Done'));
});
test('empty conversation still gives a page', () => assert.match(conversationHtml('B', []), /No messages yet/));
