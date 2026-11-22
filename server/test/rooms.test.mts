import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/rooms-test-${process.pid}.db`;
await import('../src/db-config.js');
const { mentions, pickResponders } = await import('../src/agent/rooms.js');
test('@name matches whole names only', () => {
  assert.ok(mentions('hi @sam, go', 'Sam'));
  assert.ok(mentions('@sam', 'sam'));
  assert.ok(!mentions('hi @samantha', 'Sam'));
  assert.ok(mentions('@dev-bot do it', 'dev-bot'));
  assert.ok(mentions('@c++ x', 'C++'));
});

test('whole-group messages rotate so every member gets a turn', () => {
  const m = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join('');
  assert.equal(ids(pickResponders(m, [], null)), 'abc');
  assert.equal(ids(pickResponders(m, [], 'c')), 'dea');
  assert.equal(ids(pickResponders(m, [], 'a')), 'bcd');
  assert.equal(ids(pickResponders(m.slice(0, 2), [], 'b')), 'ab');
  assert.equal(ids(pickResponders(m, [m[4], m[1]], 'c')), 'eb');
});
