import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DB_PATH = `/tmp/skills-test-${process.pid}.db`;
await import('../src/db-config.js');
const { loadLibrary, matchSkills } = await import('../src/skill-library.js');

test('shipped skills all load with matching ids and bodies', () => {
  const l = loadLibrary();
  assert.ok(l.length >= 4);
  for (const s of l) { assert.ok(s.body.length > 50, s.id); assert.ok(s.triggerTerms.length, s.id); }
});
test('trigger match is case-insensitive substring; off skills and misses are not injected', () => {
  const l = loadLibrary();
  assert.deepEqual(matchSkills('Write a LinkedIn post about our launch', l, () => true).map((s) => s.id), ['social-posts']);
  assert.equal(matchSkills('Write a LinkedIn post', l, () => false).length, 0);
  assert.equal(matchSkills('what is 2+2', l, () => true).length, 0);
});
test('bad skills are skipped, not fatal', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
  fs.mkdirSync(path.join(d, 'a')); fs.writeFileSync(path.join(d, 'a', 'manifest.json'), '{"id":"zzz","name":"x"}'); fs.writeFileSync(path.join(d, 'a', 'SKILL.md'), 'body');
  fs.mkdirSync(path.join(d, 'b')); fs.writeFileSync(path.join(d, 'b', 'manifest.json'), 'not json');
  fs.mkdirSync(path.join(d, 'ok')); fs.writeFileSync(path.join(d, 'ok', 'manifest.json'), '{"id":"ok","name":"Ok","triggerTerms":["hi"]}'); fs.writeFileSync(path.join(d, 'ok', 'SKILL.md'), '---\nname: ok\n---\nHello body');
  assert.deepEqual(loadLibrary(d).map((s) => [s.id, s.body]), [['ok', 'Hello body']]);
  assert.deepEqual(loadLibrary('/nonexistent'), []);
});

test('a blank trigger term never matches every message', async () => {
  const { matchSkills } = await import('../src/skill-library.js');
  const s = { id: 'x', name: 'x', description: '', triggerTerms: [''], defaultEnabled: true, body: 'b' };
  assert.equal(matchSkills('anything', [s], () => true).length, 0);
});
