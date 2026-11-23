import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.DB_PATH = path.join(home, 'ko.db');
await import('../src/db-config.js');
const { addKeepOut, removeKeepOut, isKeptOut, keepOutList } = await import('../src/keep-out.js');
const { LOCAL_TOOLS } = await import('../src/krish/tools.js');
const { isQuietTime, getCheckins, setCheckins, initProactive } = await import('../src/proactive.js');
const { db } = await import('../src/db.js');

test('keep-out blocks a folder, what is inside it and its tools', async () => {
  const secret = path.join(home, 'Taxes'); fs.mkdirSync(secret); fs.writeFileSync(path.join(secret, 'a.txt'), 'x');
  fs.writeFileSync(path.join(home, 'open.txt'), 'ok');
  assert.deepEqual(addKeepOut(secret), { list: [secret] });
  assert.ok(isKeptOut(path.join(secret, 'a.txt')) && isKeptOut(secret));
  assert.ok(!isKeptOut(path.join(home, 'Taxes2')) && !isKeptOut(path.join(home, 'open.txt')));
  const read = LOCAL_TOOLS.find((t) => t.name === 'read_file')!;
  assert.match(await read.run({ path: path.join(secret, 'a.txt') }, { home, cwd: home }), /keep-out/);
  assert.match(await read.run({ path: path.join(home, 'open.txt') }, { home, cwd: home }), /ok/);
  const write = LOCAL_TOOLS.find((t) => t.name === 'write_file')!;
  assert.match(await write.run({ path: path.join(secret, 'b.txt'), content: 'y' }, { home, cwd: home }), /keep-out/);
  assert.ok(!fs.existsSync(path.join(secret, 'b.txt')));
  assert.deepEqual(removeKeepOut(secret), []);
  assert.ok(!isKeptOut(secret) && keepOutList().length === 0);
});

test('secret files in the home folder are kept out, a bot workspace is not', () => {
  assert.ok(isKeptOut(path.join(home, 'id_rsa')) && isKeptOut(path.join(home, 'x', 'vault.kdbx')));
  assert.ok(!isKeptOut(path.join(home, '.openkrishbot', 'bots', 'b1', 'work', 'config.env')));
  assert.ok(!isKeptOut(path.join(os.tmpdir(), 'other', 'id_rsa')));
});

test('quiet hours wrap midnight and respect the time zone', () => {
  const q = { quietEnabled: true, quietStart: '22:00', quietEnd: '08:00', timezone: 'UTC' };
  assert.ok(isQuietTime(q, new Date('2026-01-01T23:30:00Z')) && isQuietTime(q, new Date('2026-01-01T07:59:00Z')));
  assert.ok(!isQuietTime(q, new Date('2026-01-01T08:00:00Z')) && !isQuietTime(q, new Date('2026-01-01T12:00:00Z')));
  assert.ok(isQuietTime({ ...q, timezone: 'Asia/Kolkata' }, new Date('2026-01-01T17:00:00Z'))); // 22:30 in India
  assert.ok(!isQuietTime({ ...q, quietEnabled: false }, new Date('2026-01-01T23:30:00Z')));
});

test('check-in settings keep quiet hours and reject bad times', () => {
  initProactive(() => {});
  const s = setCheckins('u1', { enabled: true, quietEnabled: true, quietStart: '23:00', quietEnd: '07:30', timezone: 'Asia/Kolkata' });
  assert.equal(s.quietEnabled, true); assert.equal(s.quietStart, '23:00'); assert.equal(s.timezone, 'Asia/Kolkata');
  assert.throws(() => setCheckins('u1', { quietStart: '25:99' }));
  assert.equal(getCheckins('u1').quietEnd, '07:30');
  db.close();
});
