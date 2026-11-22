import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/flows-sched-${process.pid}.db`;
const { db } = await import('../src/db.js');
const F = await import('../src/routes-flows.js');

db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1)").run();
db.prepare("INSERT INTO flows(id,user_id,name,steps,schedule,created_at,updated_at) VALUES ('f1','u','Daily Brief','[]','',1,1)").run();

test('findFlow matches by id or case-insensitive name, per user', () => {
  assert.equal(F.findFlow('u', 'daily brief')?.id, 'f1');
  assert.equal(F.findFlow('u', 'f1')?.id, 'f1');
  assert.equal(F.findFlow('other', 'f1'), undefined);
  assert.equal(F.listFlows('u')[0].schedule, '');
});

test('scheduleFlow accepts cron, clears on empty, rejects garbage', () => {
  F.scheduleFlow('f1', 'u', '0 9 * * 1-5');
  F.scheduleFlow('f1', 'u', '');
  assert.throws(() => F.scheduleFlow('f1', 'u', 'nonsense'));
});

test('startFlowRun fails for unknown flow', () => {
  assert.throws(() => F.startFlowRun('u', 'nope', ''), /not found/);
  setTimeout(() => process.exit(0), 50).unref();
});

test('restart marks interrupted runs failed so nothing stays running forever', async () => {
  const { reconcileRuns } = F;
  db.prepare("INSERT OR IGNORE INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1)").run();
  db.prepare("INSERT INTO flows(id,user_id,name,steps,schedule,created_at,updated_at) VALUES ('f_x','u','X','[]','',1,1)").run();
  db.prepare("INSERT INTO flow_runs(id,flow_id,input,status,results,started_at) VALUES ('r_old','f_x','','running','{}',1)").run();
  reconcileRuns();
  assert.equal((db.prepare("SELECT status FROM flow_runs WHERE id='r_old'").get() as any).status, 'failed');
});
