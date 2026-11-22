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

test('SKILL.md parsing: front matter, default triggers, explicit triggers, junk refused', async () => {
  const { parseSkillMd, parseGithubUrl } = await import('../src/skill-library.js');
  const a = parseSkillMd('---\nname: "Code Review"\ndescription: Review diffs\ntriggers: [review, "code review"]\n---\nLook at the diff.');
  assert.deepEqual([a.id, a.description, a.triggerTerms, a.body], ['code-review', 'Review diffs', ['review', 'code review'], 'Look at the diff.']);
  assert.deepEqual(parseSkillMd('# Tidy Notes\nDo it.').triggerTerms, ['tidy notes']);
  assert.throws(() => parseSkillMd('---\nname: x\n---\n'), /no name or no instructions/);
  assert.deepEqual(parseGithubUrl('https://github.com/o/r/tree/main/skills/pdf/SKILL.md'), { owner: 'o', repo: 'r', ref: 'main', dir: 'skills/pdf' });
  assert.deepEqual(parseGithubUrl('https://github.com/o/r.git'), { owner: 'o', repo: 'r', ref: undefined, dir: '' });
  assert.throws(() => parseGithubUrl('https://evil.example/o/r'), /public GitHub link/);
});

test('install, load as custom, never shadow a shipped skill, remove, import from GitHub', async () => {
  const { installSkill, removeSkill, loadLibrary, importFromGithub } = await import('../src/skill-library.js');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'usk-'));
  installSkill('---\nname: Pirate Talk\n---\nSpeak like a pirate.', d);
  assert.deepEqual(loadLibrary(d).map((s) => s.id), ['pirate-talk']);
  assert.throws(() => installSkill('---\nname: Daily brief\n---\nx', d), /built-in/);
  assert.equal(removeSkill('../etc', d), false);
  assert.equal(removeSkill('pirate-talk', d), true);
  assert.deepEqual(loadLibrary(d), []);
  let asked = '';
  const fake = (async (u: string) => { asked = u; return new Response('---\nname: From Git\n---\nBody here.', { status: 200 }); }) as unknown as typeof fetch;
  assert.equal((await importFromGithub('https://github.com/o/r/tree/dev/skills/x', fake, d)).id, 'from-git');
  assert.match(asked, /api\.github\.com\/repos\/o\/r\/contents\/skills\/x\/SKILL\.md\?ref=dev/);
  assert.equal(removeSkill('from-git', d), true);
  assert.rejects(importFromGithub('https://github.com/o/r', (async () => new Response('', { status: 404 })) as unknown as typeof fetch), /No SKILL\.md/);
});
