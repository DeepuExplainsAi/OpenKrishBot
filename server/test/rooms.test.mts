import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/rooms-test-${process.pid}.db`;
await import('../src/db-config.js');
const { mentions } = await import('../src/agent/rooms.js');
test('@name matches whole names only', () => {
  assert.ok(mentions('hi @sam, go', 'Sam'));
  assert.ok(mentions('@sam', 'sam'));
  assert.ok(!mentions('hi @samantha', 'Sam'));
  assert.ok(mentions('@dev-bot do it', 'dev-bot'));
  assert.ok(mentions('@c++ x', 'C++'));
});
