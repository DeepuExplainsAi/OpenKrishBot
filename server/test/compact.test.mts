import test from 'node:test';
import assert from 'node:assert/strict';
import { compactHistory, recentWindow, safeStart, type Msg } from '../src/krish/compact.ts';

const chat = (n: number): Msg[] => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? { role: 'user', content: `q${i} ${'x'.repeat(4000)}` } : i % 3 === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: `c${i}` }] } : { role: 'tool', tool_call_id: `c${i - 1}`, content: 'ok' }));

test('recentWindow never starts on a tool result', () => {
  const h = chat(30);
  for (let want = 3; want < 25; want++) assert.equal(recentWindow(h, want)[0].role, 'user');
  assert.equal(safeStart(h, 5) % 3, 0);
});

test('a big history is replaced by a summary plus the recent part', async () => {
  const h = chat(60);
  const before = h.length;
  const did = await compactHistory(h, 0, async (t) => (t.includes('q0') ? 'goal: x' : ''));
  assert.ok(did);
  assert.match(String(h[0].content), /Summary of the earlier conversation\]\ngoal: x/);
  assert.ok(h.length < before && h[1].role === 'user');
});

test('small history, or a failing summariser, changes nothing', async () => {
  const small = chat(6); assert.equal(await compactHistory(small, 0, async () => 's'), false); assert.equal(small.length, 6);
  const big = chat(60); assert.equal(await compactHistory(big, 0, async () => { throw new Error('model down'); }), false); assert.equal(big.length, 60);
});
