import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/danger-test-${process.pid}.db`;
await import('../src/db-config.js');
const { riskyReason, autoSkips, setDangerMode, getDangerMode } = await import('../src/danger.ts');

test('auto mode skips asking except for risky calls', () => {
  setDangerMode('auto');
  assert.equal(getDangerMode(), 'auto');
  assert.equal(autoSkips('write_file', { path: 'a.txt' }), true);
  assert.equal(autoSkips('terminal', { command: 'rm -rf ~' }), false);
  assert.ok(riskyReason('STRIPE_CREATE_PAYMENT', {}));
  assert.ok(riskyReason('PAYPAL_PAYOUT_SEND', {}));
  setDangerMode('ask');
  assert.equal(autoSkips('write_file', { path: 'a.txt' }), false);
});
