import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepMessage } from '../src/agent/pipeline.ts';

test('pipeline: middle step forwards the rest, last step reports to the starter', () => {
  const steps = [{ bot: 'A', task: 'research' }, { bot: 'B', task: 'write' }, { bot: 'C', task: 'review' }];
  const mid = stepMessage(steps, 1, 'Boss');
  assert.match(mid, /step 2 of 3/);
  assert.match(mid, /send_to_bot to "C"/);
  assert.match(mid, /"task":"review"/);
  assert.doesNotMatch(mid, /"task":"write"/);
  assert.match(stepMessage(steps, 2, 'Boss'), /send_to_bot to "Boss" with the final result/);
});
