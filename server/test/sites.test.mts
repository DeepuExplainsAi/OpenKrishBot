import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.DB_PATH = `/tmp/sites-test-${process.pid}.db`;
process.env.KRISH_USER_SKILLS_DIR = path.join(home, 'skills');
const { libraryRoot } = await import('../src/paths.js');
const { siteFile, listSites } = await import('../src/sites.js');
const { TOOLS } = await import('../src/agent/tools.js');
const { loadAll } = await import('../src/skill-library.js');
const w = (rel: string, body = 'x') => { const f = path.join(libraryRoot(), 'b1', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
w('site/index.html', '<h1>hi</h1>'); w('site/app.js', '1'); w('notes/readme.txt'); fs.mkdirSync(path.join(libraryRoot(), 'b2'), { recursive: true }); fs.writeFileSync(path.join(libraryRoot(), 'b2', 'secret.txt'), 's');

test('siteFile serves index.html for a folder and files inside it', () => {
  assert.ok(siteFile('b1', 'site/')?.endsWith(path.join('site', 'index.html')));
  assert.ok(siteFile('b1', 'site/app.js')?.endsWith('app.js'));
  assert.equal(siteFile('b1', 'site/missing.css'), null);
  assert.equal(siteFile('b1', 'notes/'), null);
});
test('siteFile refuses to leave the bot folder (other bots, parent folders)', () => {
  assert.equal(siteFile('b1', '../b2/secret.txt'), null);
  assert.equal(siteFile('b1', 'site/../../b2/secret.txt'), null);
  assert.equal(siteFile('b1', '../../../etc/passwd'), null);
});
test('listSites lists folders with an index.html only', () => assert.deepEqual(listSites('b1'), ['site']));

const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
const ctx = { userId: 'u', botId: 'b1', enqueueBotMessage: () => {}, depth: 0 } as any;
test('publish_site returns the path, or says what is missing', async () => {
  assert.equal(JSON.parse((await tool('publish_site').impl({ folder: 'site' }, ctx)).output).url, '/sites/b1/site/');
  assert.match(JSON.parse((await tool('publish_site').impl({ folder: 'nope' }, ctx)).output).error, /No nope\/index\.html/);
});
test('save_skill writes a skill that loads and matches its triggers; built-in ids are refused', async () => {
  const r = JSON.parse((await tool('save_skill').impl({ name: 'Weekly sales report', instructions: '1. Pull the CSV\n2. Chart it', triggers: ['sales report', 'weekly numbers'] }, ctx)).output);
  assert.equal(r.id, 'weekly-sales-report');
  const sk = loadAll().find((s) => s.id === r.id)!;
  assert.deepEqual(sk.triggerTerms, ['sales report', 'weekly numbers']);
  assert.ok(sk.custom && sk.body.includes('Pull the CSV'));
  assert.match(JSON.parse((await tool('save_skill').impl({ name: 'Chart', instructions: 'x' }, ctx)).output).error, /built-in/);
});
