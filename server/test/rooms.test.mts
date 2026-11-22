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

test('a bot posts once per user message in a room; the next user message reopens it', async () => {
  const { db, now } = await import('../src/db.js');
  const { createRoom, postToRoom, initRooms } = await import('../src/agent/rooms.js');
  initRooms();
  const { appendRow } = await import('../src/store.js');
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('u1', 'u@x.t', 'U', now());
  for (const [id, name] of [['b1', 'Ada'], ['b2', 'Bo']]) db.prepare('INSERT INTO bots(id,user_id,name,label,description,avatar_shape,avatar_color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, 'u1', name, '', '', 'blob', 'black', now(), now());
  const room = createRoom('u1', 'Team', ['b1', 'b2']);
  appendRow(room, 'message', { type: 'message', role: 'user', text: 'hi all' });
  assert.equal(postToRoom('b1', 'Team', 'first'), 'Posted to the group.');
  assert.match(postToRoom('b1', 'Team', 'again'), /already replied/);
  assert.equal(postToRoom('b2', 'Team', 'mine'), 'Posted to the group.');
  appendRow(room, 'message', { type: 'message', role: 'user', text: 'next' });
  assert.equal(postToRoom('b1', 'Team', 'new turn'), 'Posted to the group.');
});
