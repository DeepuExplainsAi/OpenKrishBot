import test from 'node:test';
import assert from 'node:assert/strict';
const { createRelay, MARK, digits, chunk } = await import('../src/whatsapp-relay.js');

function setup(allowedFn = (_j: string, fromMe: boolean, self: boolean) => (fromMe && self)) {
  const log: string[] = [];
  let pending: string | null = null;
  const relay = createRelay({
    botId: 'b', allowed: allowedFn,
    send: async (j, t) => { log.push(`send ${j}: ${t}`); },
    say: (t) => log.push(`say ${t}`), interrupt: () => log.push('interrupt'),
    pendingApproval: () => pending, answerApproval: (id, d) => log.push(`approve ${id} ${d}`),
  });
  return { log, relay, setPending: (p: string | null) => { pending = p; } };
}
const row = (seq: number, body: any) => ({ botId: 'b', generation: 1, seq, updatedSeq: 1, kind: body.type, body, createdAt: 0 }) as any;

test('self-chat message becomes a turn; strangers are ignored', async () => {
  const s = setup();
  await s.relay.onMessage('me@s.whatsapp.net', 'check my mail', true, true);
  await s.relay.onMessage('x@s.whatsapp.net', 'hack', false, false);
  assert.deepEqual(s.log, ['say check my mail']);
});

test('own replies (marked) are never re-read as commands', async () => {
  const s = setup();
  await s.relay.onMessage('me@s.whatsapp.net', `${MARK}Done`, true, true);
  assert.deepEqual(s.log, []);
});

test('replies go to the chat that spoke last, once each; streaming rows wait', async () => {
  const s = setup();
  await s.relay.onRow(row(1, { type: 'message', role: 'assistant', text: 'before any chat', streaming: false }));
  await s.relay.onMessage('me@s.whatsapp.net', 'hi', true, true);
  await s.relay.onRow(row(2, { type: 'message', role: 'assistant', text: 'part', streaming: true }));
  await s.relay.onRow(row(2, { type: 'message', role: 'assistant', text: 'part one', streaming: false }));
  await s.relay.onRow(row(2, { type: 'message', role: 'assistant', text: 'part one', streaming: false }));
  assert.deepEqual(s.log, ['say hi', `send me@s.whatsapp.net: ${MARK}part one`]);
});

test('approval card is sent with choices; 1/2/3 and words answer it', async () => {
  const s = setup();
  await s.relay.onMessage('me@s.whatsapp.net', 'do it', true, true);
  await s.relay.onRow(row(3, { type: 'card', card: 'approval', status: 'pending', title: 'Allow Krish to send an email?', detail: 'to bob' }));
  assert.match(s.log[1], /Allow Krish to send an email\?\nto bob\n\nReply 1/);
  s.setPending('apr_1');
  await s.relay.onMessage('me@s.whatsapp.net', '1', true, true);
  await s.relay.onMessage('me@s.whatsapp.net', 'always', true, true);
  await s.relay.onMessage('me@s.whatsapp.net', 'nahi', true, true);
  assert.deepEqual(s.log.slice(2), ['approve apr_1 allow', 'approve apr_1 always', 'approve apr_1 deny']);
});

test('"1" without a pending approval is just a message', async () => {
  const s = setup();
  await s.relay.onMessage('me@s.whatsapp.net', '1', true, true);
  assert.deepEqual(s.log, ['say 1']);
});

test('stop interrupts', async () => {
  const s = setup();
  await s.relay.onMessage('me@s.whatsapp.net', 'stop', true, true);
  assert.deepEqual(s.log, ['interrupt', `send me@s.whatsapp.net: ${MARK}Stopped.`]);
});

test('errors are surfaced', async () => {
  const s = setup();
  await s.relay.onMessage('me@s.whatsapp.net', 'go', true, true);
  await s.relay.onRow(row(4, { type: 'notice', tone: 'error', text: 'Free cloud is down.' }));
  assert.match(s.log[1], /⚠️ Free cloud is down\./);
});

test('digits and chunk', () => {
  assert.equal(digits('919876543210:12@s.whatsapp.net'), '919876543210');
  assert.equal(digits('+91 98765-43210'), '919876543210');
  const parts = chunk(('a'.repeat(1000) + '\n\n').repeat(10), 3500);
  assert.ok(parts.every((p) => p.length <= 3500) && parts.length === 4 && parts.join("").length >= 10000);
});
