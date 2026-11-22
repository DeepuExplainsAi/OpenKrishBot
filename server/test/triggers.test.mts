import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/trig-test-${process.pid}.db`;
await import('../src/db-config.js');
const { conditionHolds, allHold, parseConditions } = await import('../src/conditions.js');
const { parseFeed } = await import('../src/feed.js');

test('conditions: dot paths and operators', () => {
  const d = { repo: { name: 'Krish', stars: 12 }, items: [{ title: 'Hello' }] };
  assert.ok(conditionHolds({ field: 'repo.name', op: 'equals', value: 'krish' }, d));
  assert.ok(conditionHolds({ field: 'items.0.title', op: 'starts_with', value: 'he' }, d));
  assert.ok(conditionHolds({ field: 'repo.stars', op: 'greater_than', value: '10' }, d));
  assert.ok(!conditionHolds({ field: 'repo.stars', op: 'less_than', value: '10' }, d));
  assert.ok(!conditionHolds({ field: 'nope', op: 'exists' }, d));
  assert.ok(allHold([], d) && !allHold([{ field: 'repo.name', op: 'contains', value: 'zzz' }], d));
});
test('parseConditions rejects bad input', () => {
  assert.deepEqual(parseConditions(undefined), []);
  assert.throws(() => parseConditions([{ field: 'a', op: 'bogus' }]), /unknown condition/);
  assert.throws(() => parseConditions('x'), /list/);
});
test('parseFeed reads RSS and Atom', () => {
  const rss = '<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>http://x/1</link><guid>g1</guid><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss>';
  assert.deepEqual(parseFeed(rss).map((i) => [i.id, i.title, i.summary]), [['g1', 'A & B', 'Hi']]);
  const atom = '<feed><entry><id>t1</id><title>T</title><link href="http://x/2"/><summary>S</summary><author><name>N</name></author></entry></feed>';
  assert.deepEqual(parseFeed(atom).map((i) => [i.id, i.link, i.author]), [['t1', 'http://x/2', 'N']]);
});
test('feed routine: first poll only remembers, later polls fire only new matching items', async () => {
  const { db } = await import('../src/db.js');
  const { createFeedRoutine, pollFeedRoutine } = await import('../src/triggers.js');
  const uid = 'u1', bid = 'b1';
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,1)').run(uid, 'a@b.c', 'A');
  db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,1,1)").run(bid, uid, 'Bot');
  const feed = (ids: string[]) => (async () => new Response(`<rss><channel>${ids.map((i) => `<item><guid>${i}</guid><title>post ${i}</title></item>`).join('')}</channel></rss>`)) as unknown as typeof fetch;
  const { id } = createFeedRoutine(bid, { name: 'f', prompt: 'p', url: 'http://feed.test/rss', conditions: [{ field: 'title', op: 'contains', value: 'post' }] });
  const row = () => db.prepare('SELECT * FROM routines WHERE id=?').get(id);
  assert.equal(await pollFeedRoutine(row(), feed(['1', '2'])), 0);
  assert.equal(await pollFeedRoutine(row(), feed(['1', '2'])), 0);
  assert.equal(await pollFeedRoutine(row(), feed(['1', '2', '3'])), 1);
  assert.throws(() => createFeedRoutine(bid, { name: 'x', prompt: 'p', url: 'file:///etc/passwd' }), /http/);
});
