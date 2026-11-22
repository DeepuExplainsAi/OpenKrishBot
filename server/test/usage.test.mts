import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/usage-test-${process.pid}.db`;
const { db } = await import('../src/db.js');
await import('../src/db-config.js');
const U = await import('../src/usage.js');
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1)").run();
db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b','u','Bee',1,1)").run();

test('usage adds up per day and calls count', () => {
  U.recordUsage('b', 100, 50); U.recordUsage('b', 10.4, 5);
  assert.deepEqual(U.usageToday('b'), { tokensIn: 110, tokensOut: 55, calls: 2 });
  assert.equal(U.usageToday('b', Date.now() + 2 * 86_400_000).calls, 0);
});
test('no budget means never blocked; cap blocks once reached, next day is free', () => {
  assert.equal(U.overBudget('b'), null);
  U.setBudget('b', 200);
  assert.equal(U.overBudget('b'), null);
  U.recordUsage('b', 30, 10);
  assert.match(U.overBudget('b')!, /daily limit of 200/);
  assert.equal(U.overBudget('b', Date.now() + 2 * 86_400_000), null);
  U.setBudget('b', null);
  assert.equal(U.overBudget('b'), null);
  assert.equal(U.getBudget('b'), null);
});
test('estimate and summary', () => {
  assert.equal(U.estimateTokens(10), 3);
  const s = U.usageSummary('u');
  assert.equal(s[0].name, 'Bee');
  assert.equal(s[0].tokensIn, 140);
});

test('price: cost is tokens x price, no price means free, bad price rejected by shape', async () => {
  const { costOf, getPrice, setPrice } = await import('../src/usage.js');
  assert.equal(costOf(null, 1e6, 1e6), 0);
  assert.equal(costOf({ inPerM: 1, outPerM: 3 }, 2e6, 1e6), 5);
  setPrice('bp', { inPerM: 0.5, outPerM: 1.5 });
  assert.deepEqual(getPrice('bp'), { inPerM: 0.5, outPerM: 1.5 });
  setPrice('bp', { inPerM: 0, outPerM: 0 });
  assert.equal(getPrice('bp'), null);
});
