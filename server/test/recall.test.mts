import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/krish/recall.ts';

test('recall ranks by rare shared words, newest wins ties', () => {
  const docs = [
    { text: 'User: ship the order to Pune warehouse', at: 1 },
    { text: 'User: the order is late', at: 2 },
    { text: 'User: the weather is nice', at: 3 },
    { text: 'User: ship to Pune again', at: 4 },
  ];
  assert.deepEqual(rank(docs, 'pune address').map((d) => d.at), [4, 1]);
  assert.deepEqual(rank(docs, 'order').map((d) => d.at), [2, 1]);
  assert.deepEqual(rank(docs, 'zzz'), []);
  assert.deepEqual(rank(docs, 'a'), []);
});
