import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/issues-test-${process.pid}.db`;
const { db } = await import('../src/db.js');
const I = await import('../src/issues.js');

db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1)").run();
for (const [id, name] of [['b1', 'Alpha'], ['b2', 'Beta'], ['b3', 'Gamma']]) db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,1,1)").run(id, 'u', name);
const woken: [string, string][] = [];
I.initIssues((b, t) => woken.push([b, t]));
const mk = (o: any = {}) => I.createIssue({ userId: 'u', title: 'T', ...o });

test('assigning wakes the assignee; unassigned does not', () => {
  woken.length = 0;
  mk();
  assert.equal(woken.length, 0);
  const i = mk({ assigneeBotId: 'b1', createdByBotId: 'b3' });
  assert.equal(woken[0][0], 'b1');
  assert.match(woken[0][1], new RegExp(i.id));
});

test('checkout is exclusive: second bot and wrong bot are refused', () => {
  const i = mk({ assigneeBotId: 'b1' });
  assert.equal(I.checkout(i.id, 'b2').ok, false);
  assert.equal(I.checkout(i.id, 'b1').ok, true);
  const again = I.checkout(i.id, 'b1');
  assert.equal(again.ok, false);
  assert.match((again as any).reason, /already has it/);
});

test('unassigned issue is claimed by the first bot only', () => {
  const i = mk();
  assert.equal(I.checkout(i.id, 'b2').ok, true);
  assert.equal(I.getIssue(i.id)!.assigneeBotId, 'b2');
  assert.equal(I.checkout(i.id, 'b1').ok, false);
});

test('only the holder can finish; creator is told', () => {
  const i = mk({ assigneeBotId: 'b1', createdByBotId: 'b3' });
  I.checkout(i.id, 'b1');
  assert.equal(I.finish(i.id, 'b2', 'done', 'x').ok, false);
  woken.length = 0;
  assert.equal(I.finish(i.id, 'b1', 'done', 'all good').ok, true);
  assert.deepEqual(woken.map((w) => w[0]), ['b3']);
  assert.match(woken[0][1], /all good/);
  assert.equal(I.getIssue(i.id)!.status, 'done');
});

test('parent cannot complete while sub-issues are open, and is nudged when the last one finishes', () => {
  const p = mk({ assigneeBotId: 'b1' });
  I.checkout(p.id, 'b1');
  const c1 = mk({ assigneeBotId: 'b2', createdByBotId: 'b1', parentId: p.id });
  const c2 = mk({ assigneeBotId: 'b3', createdByBotId: 'b1', parentId: p.id });
  assert.match((I.finish(p.id, 'b1', 'done') as any).reason, /2 unfinished/);
  I.checkout(c1.id, 'b2'); I.finish(c1.id, 'b2', 'done', 'r1');
  I.checkout(c2.id, 'b3'); woken.length = 0; I.finish(c2.id, 'b3', 'done', 'r2');
  assert.ok(woken.some(([b, t]) => b === 'b1' && /All sub-issues/.test(t)));
  assert.equal(I.finish(p.id, 'b1', 'done', 'merged').ok, true);
});

test('releasing to todo lets someone else take it; reassign by user releases checkout', () => {
  const i = mk({ assigneeBotId: 'b1' });
  I.checkout(i.id, 'b1');
  const moved = I.setStatus('u', i.id, { assigneeBotId: 'b2' })!;
  assert.equal(moved.checkoutBotId, null);
  assert.equal(moved.status, 'todo');
  assert.equal(I.checkout(i.id, 'b2').ok, true);
});

test('heartbeat wakes idle assignee once per interval, skips busy bots', () => {
  const i = mk({ assigneeBotId: 'b2' });
  woken.length = 0;
  assert.equal(I.heartbeat(() => false), 0); // just woken
  const later = Date.now() + 11 * 60_000;
  assert.equal(I.heartbeat(() => true, later), 0);
  const n = I.heartbeat(() => false, later);
  assert.ok(n >= 1);
  assert.ok(woken.some(([b, t]) => b === 'b2' && t.includes(i.id)));
});

test('bad input: empty title, unknown parent', () => {
  assert.throws(() => mk({ title: '  ' }), /title/);
  assert.throws(() => mk({ parentId: 'nope' }), /No issue/);
});

test('comments: bot note wakes creator and assignee (not the author); user note wakes holder; closed issues stay quiet', () => {
  const i = mk({ assigneeBotId: 'b1', createdByBotId: 'b3' });
  woken.length = 0;
  const r = I.addComment('u', i.id, 'b1', 'need the API key');
  assert.equal(r.ok, true);
  assert.deepEqual(woken.map((w) => w[0]), ['b3']);
  woken.length = 0;
  I.addComment('u', i.id, null, 'use the staging one');
  assert.deepEqual(woken.map((w) => w[0]).sort(), ['b1', 'b3']);
  assert.equal(I.listComments('u', i.id).length, 2);
  assert.equal(I.addComment('u', i.id, null, '  ').ok, false);
  assert.equal(I.addComment('intruder', i.id, null, 'hi').ok, false);
  assert.deepEqual(I.listComments('intruder', i.id), []);
  assert.equal(I.addComment('u', 'nope', null, 'x').ok, false);
  I.setStatus('u', i.id, { status: 'cancelled' });
  woken.length = 0;
  I.addComment('u', i.id, null, 'late');
  assert.equal(woken.length, 0);
});

test('bot-to-bot comment ping-pong stops waking after a run of 6; a user note resets it', () => {
  const i = mk({ assigneeBotId: 'b1', createdByBotId: 'b2' });
  woken.length = 0;
  for (let n = 0; n < 12; n++) I.addComment('u', i.id, n % 2 ? 'b2' : 'b1', `m${n}`);
  assert.ok(woken.length <= 7, `woken ${woken.length}`);
  woken.length = 0;
  I.addComment('u', i.id, null, 'carry on');
  assert.ok(woken.length >= 1);
});

const age = (id: string, ms: number) => db.prepare('UPDATE issues SET updated_at=updated_at-?, last_wake=last_wake-? WHERE id=?').run(ms, ms, id);
const stopped: string[] = [];
I.initIssueControl((b) => stopped.push(b));

test('a holder that went idle loses a stale checkout, and is nudged once', () => {
  const i = mk({ assigneeBotId: 'b1' });
  I.checkout(i.id, 'b1');
  age(i.id, 11 * 60_000);
  woken.length = 0;
  assert.equal(I.heartbeat(() => false), 1);
  assert.equal(I.getIssue(i.id)!.status, 'todo');
  assert.equal(I.getIssue(i.id)!.checkoutBotId, null);
  assert.equal(woken.at(-1)![0], 'b1');
  assert.equal(I.checkout(i.id, 'b1').ok, true);
});

test('a busy holder keeps its checkout', () => {
  const i = mk({ assigneeBotId: 'b1' });
  I.checkout(i.id, 'b1');
  age(i.id, 11 * 60_000);
  I.heartbeat(() => true);
  assert.equal(I.getIssue(i.id)!.checkoutBotId, 'b1');
});

test('an ignored issue wakes its assignee 3 times in total (creation + 2 nudges), then stops costing tokens', () => {
  woken.length = 0;
  const i = mk({ assigneeBotId: 'b2' });
  for (let n = 0; n < 6; n++) { age(i.id, 11 * 60_000); I.heartbeat(() => false); }
  assert.equal(woken.filter(([b, t]) => b === 'b2' && t.includes(i.id)).length, 3);
});

test('setting in_progress by hand cannot strand an issue', () => {
  const i = mk({ assigneeBotId: 'b1' });
  const r = I.setStatus('u', i.id, { status: 'in_progress' }) as any;
  assert.equal(r.status, 'todo');
  assert.equal(I.checkout(i.id, 'b1').ok, true);
});

test('cancelling stops the bot that was working on it', () => {
  const i = mk({ assigneeBotId: 'b1' });
  I.checkout(i.id, 'b1');
  stopped.length = 0;
  I.setStatus('u', i.id, { status: 'cancelled' });
  assert.deepEqual(stopped, ['b1']);
});

test('user cannot mark a parent done over open sub-issues, or assign a bot that does not exist', () => {
  const p = mk(); mk({ parentId: p.id });
  assert.match((I.setStatus('u', p.id, { status: 'done' }) as any).error, /unfinished/);
  assert.match((I.setStatus('u', p.id, { assigneeBotId: 'nope' }) as any).error, /does not exist/);
});

test('deleting a bot frees its issues', () => {
  db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b9','u','Temp',1,1)").run();
  const i = mk({ assigneeBotId: 'b9' });
  I.checkout(i.id, 'b9');
  I.releaseBotIssues('b9');
  const after = I.getIssue(i.id)!;
  assert.equal(after.checkoutBotId, null); assert.equal(after.assigneeBotId, null); assert.equal(after.status, 'todo');
});
