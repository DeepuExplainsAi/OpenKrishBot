import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/tg-test-${process.pid}.db`;
await import('../src/db-config.js');
const { handleUpdate } = await import('../src/telegram.js');

const run = async (text: string, o: { pairCode?: string | null; allow?: string[]; type?: string } = {}) => {
  const log: string[] = [];
  await handleUpdate({ update_id: 1, message: { chat: { id: 42, type: o.type ?? 'private' }, text } }, {
    pairCode: o.pairCode ?? null, allow: o.allow ?? [],
    pair: (c) => log.push(`pair:${c}`), reply: async (_c, t) => { log.push(`reply:${t}`); }, relay: async (_c, t) => { log.push(`relay:${t}`); },
  });
  return log;
};

test('stranger gets nothing except a pointer on /start; never reaches the bot', async () => {
  assert.deepEqual(await run('hello'), []);
  assert.match((await run('/start'))[0], /private/);
});
test('right code pairs, wrong or expired code does not', async () => {
  assert.deepEqual((await run('/pair 123456', { pairCode: '123456' })).map((x) => x.split(':')[0]), ['pair', 'reply']);
  assert.match((await run('/pair 000000', { pairCode: '123456' }))[0], /Wrong/);
  assert.match((await run('/pair 123456', { pairCode: null }))[0], /Wrong/);
});
test('paired chat is relayed; groups and non-text are ignored even if allowed', async () => {
  assert.deepEqual(await run('do it', { allow: ['42'] }), ['relay:do it']);
  assert.deepEqual(await run('do it', { allow: ['42'], type: 'group' }), []);
  assert.deepEqual(await handleUpdate({ update_id: 2, message: { chat: { id: 42, type: 'private' } } } as any, { pairCode: null, allow: ['42'], pair() {}, reply: async () => {}, relay: async () => { throw new Error('no'); } }), undefined);
});
