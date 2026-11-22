import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/proj-test-${process.pid}.db`;
const { db } = await import('../src/db.js');
const P = await import('../src/projects.js');
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1),('v','v@x','V',1)").run();
for (const id of ['b1', 'b2']) db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,1,1)").run(id, 'u', id);

test('project: instructions and files reach the bot prompt; other users cannot touch it', () => {
  const p = P.createProject('u', { name: 'Launch', instructions: 'Always answer in Hindi.' }) as any;
  assert.equal(P.assignBot('u', 'b1', p.id), null);
  P.addFile('u', p.id, { name: 'brand.md', content: 'Tone: friendly' });
  P.addFile('u', p.id, { name: 'big.txt', content: 'x'.repeat(7000) });
  const text = P.projectPrompt('b1');
  assert.match(text, /Always answer in Hindi/);
  assert.match(text, /Tone: friendly/);
  assert.match(text, /big\.txt[\s\S]*read_project_file/);
  assert.equal(P.projectPrompt('b2'), '');
  assert.equal(P.readProjectFileByName('b1', 'BIG.txt')?.content.length, 7000);
  assert.equal(P.readProjectFileByName('b2', 'big.txt'), null);
  assert.equal(P.updateProject('v', p.id, { name: 'x' }), null);
  assert.equal(P.deleteProject('v', p.id), false);
  assert.equal(P.assignBot('v', 'b1', null), 'No such bot.');
});
test('project: limits and same-name overwrite', () => {
  const p = P.createProject('u', { name: 'L' }) as any;
  assert.ok('error' in (P.addFile('u', p.id, { name: 'a', content: 'x'.repeat(P.MAX_FILE_CHARS + 1) }) as any));
  P.addFile('u', p.id, { name: 'a.txt', content: '1' }); P.addFile('u', p.id, { name: 'A.txt', content: '2' });
  assert.equal(P.listProjects('u').find((x) => x.id === p.id)!.files.length, 1);
  assert.ok('error' in (P.createProject('u', { name: ' ' }) as any));
});
test('deleting a project frees its bots', () => {
  const p = P.createProject('u', { name: 'D' }) as any;
  P.assignBot('u', 'b2', p.id);
  assert.equal(P.deleteProject('u', p.id), true);
  assert.equal((db.prepare('SELECT project_id FROM bots WHERE id=?').get('b2') as any).project_id, null);
});
