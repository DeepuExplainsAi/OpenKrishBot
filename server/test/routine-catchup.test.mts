import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missedSince } from '../src/routines.ts';

const at = Date.UTC(2026, 10, 22, 12, 0); // 12:00 UTC
const h = (n: number) => n * 3600_000;

test('a daily 09:00 run that fell while the app was off is caught up once', () => {
  assert.ok(missedSince('0 9 * * *', 'UTC', at - h(30), at));
});
test('already ran since the last due time: nothing to catch up', () => {
  assert.ok(!missedSince('0 9 * * *', 'UTC', at - h(2), at));
});
test('created after the last due time: not missed', () => {
  assert.ok(!missedSince('0 9 * * *', 'UTC', at - h(1), at));
});
test('older than 24 h is dropped, triggers and bad schedules are ignored', () => {
  assert.ok(!missedSince('0 9 1 * *', 'UTC', at - h(1000), at));
  assert.ok(!missedSince('event:abc', 'UTC', 0, at));
  assert.ok(!missedSince('not a cron', 'UTC', 0, at));
});
