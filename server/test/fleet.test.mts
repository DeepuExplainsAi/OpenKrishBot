import test from 'node:test';
import assert from 'node:assert/strict';
import { policyFor } from '../src/agent/tools.ts';

test('update_bot asks first; other built-in tools run', () => {
  assert.equal(policyFor('u1', 'update_bot', {}).decision, 'ask');
  assert.equal(policyFor('u1', 'list_bots', {}).decision, 'allow');
});
