import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { localToolMap } = await import('../src/krish/tools.js');
const { dangerReason } = await import('../src/danger.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'));
const ctx = { home: dir, cwd: dir };
const run = (name: string, a: any) => localToolMap.get(name)!.run(a, ctx);

test('patch matches LF text in a CRLF file and keeps CRLF', async () => {
  const f = path.join(dir, 'w.txt');
  fs.writeFileSync(f, 'one\r\ntwo\r\nthree\r\n');
  await run('patch', { path: f, old_text: 'one\ntwo', new_text: 'ONE\nTWO' });
  assert.equal(fs.readFileSync(f, 'utf8'), 'ONE\r\nTWO\r\nthree\r\n');
});
test('patch refuses empty, missing and ambiguous text', async () => {
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'x x');
  assert.match(await run('patch', { path: f, old_text: '', new_text: 'y' }), /empty/);
  assert.match(await run('patch', { path: f, old_text: 'zzz', new_text: 'y' }), /not found/);
  assert.match(await run('patch', { path: f, old_text: 'x', new_text: 'y' }), /2 times/);
});
test('search_files lists and greps without bash, skipping node_modules', async () => {
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'skip.txt'), 'needle');
  fs.writeFileSync(path.join(dir, 'find.txt'), 'a\nneedle here\n');
  assert.match(await run('search_files', {}), /find\.txt/);
  const hit = await run('search_files', { pattern: 'needle' });
  assert.match(hit, /find\.txt:2:needle here/);
  assert.doesNotMatch(hit, /skip\.txt/);
  assert.match(await run('search_files', { pattern: '(' }), /bad regex/);
});
test('a timed-out command says so instead of just exit 1', async () => {
  const out = JSON.parse(await run('terminal', { command: process.platform === 'win32' ? 'ping -n 6 127.0.0.1' : 'sleep 5', timeout: 1 }));
  assert.match(out.output, /timed out after 1s/);
});
test('danger rules catch the home and glob variants', () => {
  for (const c of ['rm -rf /', 'rm -rf /*', 'rm -rf ~/', 'rm -rf ~', 'rm -rf $HOME/', 'rm -rf "/"', 'rm -rf ${HOME}']) assert.ok(dangerReason('terminal', { command: c }), c);
  for (const c of ['rm -rf build', 'rm -rf ./dist', 'rm file.txt']) assert.equal(dangerReason('terminal', { command: c }), null, c);
});
