import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelQueued, isBotBusy, pauseQueue, queueView, resumeQueue, runInBotQueue } from '../src/agent/loop.ts';

test('queue runs in order, pauses, and cancels waiting items', async () => {
  const id = 'q-test-bot';
  const order: number[] = [];
  let release!: () => void;
  const first = runInBotQueue(id, () => new Promise<void>((r) => { release = r; }).then(() => { order.push(1); }));
  pauseQueue(id);
  const second = runInBotQueue(id, async () => { order.push(2); });
  const third = runInBotQueue(id, async () => { order.push(3); });
  third.catch(() => {});
  assert.equal(queueView(id).pending.length, 2);
  assert.equal(cancelQueued(id, queueView(id).pending[1].id), 1);
  release();
  await first;
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, [1], 'paused: nothing after the running turn');
  resumeQueue(id);
  await second;
  await assert.rejects(third, /cancelled/);
  assert.deepEqual(order, [1, 2]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(isBotBusy(id), false);
});
