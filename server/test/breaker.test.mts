import test from 'node:test';
import assert from 'node:assert/strict';
const { isOpen, recordFailure, recordSuccess, resetBreakers } = await import('../src/krish/breaker.js');

test('opens after two failures, closes on success or after cooldown', () => {
  resetBreakers();
  recordFailure('a', 1000);
  assert.equal(isOpen('a', 1001), false);
  recordFailure('a', 1000);
  assert.equal(isOpen('a', 1001), true);
  assert.equal(isOpen('a', 1000 + 61_000), false);
  recordSuccess('a');
  assert.equal(isOpen('a', 1001), false);
});
