import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/goals-test-${process.pid}.db`;
await import('../src/db-config.js');
const { db, now } = await import('../src/db.js');
const { createIssue, setStatus } = await import('../src/issues.js');
const { initRooms } = await import('../src/agent/rooms.js');
initRooms();
const g = await import('../src/goals.js');

db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u1','a@b.c','A',?)").run(now());
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u2','d@e.f','D',?)").run(now());
const ok = <T,>(x: T | { error: string }): T => { assert.ok(!(x && typeof x === 'object' && 'error' in x), JSON.stringify(x)); return x as T; };

test('tree, progress rolls up from sub-goals', () => {
  const m = ok(g.createGoal('u1', { title: 'Launch' }));
  assert.equal(m.level, 'mission');
  const p = ok(g.createGoal('u1', { title: 'Site', parentId: m.id }));
  assert.equal(p.level, 'task');
  const i1 = createIssue({ userId: 'u1', title: 'a', goalId: p.id });
  createIssue({ userId: 'u1', title: 'b', goalId: p.id });
  const sub = createIssue({ userId: 'u1', title: 'c', parentId: i1.id });
  assert.equal(sub.goalId, p.id, 'sub-issue inherits goal');
  setStatus('u1', sub.id, { status: 'done' });
  const list = g.listGoals('u1');
  assert.deepEqual([list.find((x) => x.id === m.id)!.done, list.find((x) => x.id === m.id)!.total], [1, 3]);
  assert.deepEqual([list.find((x) => x.id === p.id)!.done, list.find((x) => x.id === p.id)!.total], [1, 3]);
});

test('validation: cycle, foreign parent, bad level/status, unknown goal on an issue', () => {
  const a = ok(g.createGoal('u1', { title: 'A' }));
  const b = ok(g.createGoal('u1', { title: 'B', parentId: a.id }));
  assert.match((g.updateGoal('u1', a.id, { parentId: b.id }) as any).error, /under itself/);
  assert.match((g.updateGoal('u1', a.id, { parentId: a.id }) as any).error, /under itself/);
  assert.match((g.createGoal('u2', { title: 'x', parentId: a.id }) as any).error, /parent/);
  assert.match((g.createGoal('u1', { title: 'x', level: 'nope' as any }) as any).error, /level/);
  assert.match((g.updateGoal('u1', a.id, { status: 'nope' as any }) as any).error, /status/);
  assert.match((g.createGoal('u1', { title: '  ' }) as any).error, /title/);
  assert.throws(() => createIssue({ userId: 'u1', title: 't', goalId: 'goal_nope' }), /No goal/);
  assert.equal(g.updateGoal('u2', a.id, { title: 'hack' }), null);
  assert.match((g.createGoal('u1', { title: 'x', ownerBotId: 'nobot' }) as any).error, /bot/);
});

test('delete lifts sub-goals and issues to the parent', () => {
  const a = ok(g.createGoal('u1', { title: 'Top' }));
  const b = ok(g.createGoal('u1', { title: 'Mid', parentId: a.id }));
  const c = ok(g.createGoal('u1', { title: 'Leaf', parentId: b.id }));
  const i = createIssue({ userId: 'u1', title: 'x', goalId: b.id });
  assert.equal(g.deleteGoal('u1', b.id), true);
  assert.equal(g.listGoals('u1').find((x) => x.id === c.id)!.parentId, a.id);
  assert.equal((db.prepare('SELECT goal_id g FROM issues WHERE id=?').get(i.id) as any).g, a.id);
  assert.equal(g.deleteGoal('u2', a.id), false);
});

test('linkIssue checks ownership both ways', () => {
  const a = ok(g.createGoal('u1', { title: 'L' }));
  const i = createIssue({ userId: 'u1', title: 'y' });
  assert.equal(g.linkIssue('u1', i.id, a.id), null);
  assert.equal(g.linkIssue('u1', i.id, null), null);
  assert.match(g.linkIssue('u2', i.id, null)!, /issue/);
  assert.match(g.linkIssue('u1', i.id, 'goal_x')!, /goal/);
});
