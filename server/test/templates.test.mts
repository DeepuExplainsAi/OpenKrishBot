import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('every company template is a valid openkrishbot-company-v1 file within limits', () => {
  const dir = fileURLToPath(new URL('../templates/', import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.company.json'));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const t = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    assert.equal(t.format, 'openkrishbot-company-v1');
    assert.ok(t.bots.length > 0 && t.bots.length <= 20);
    assert.equal(new Set(t.bots.map((b: any) => b.name)).size, t.bots.length);
    for (const b of t.bots) assert.ok(b.name && b.instructions);
  }
});

test('role goal and backstory go in front of the instructions', async () => {
  const { importCompany } = await import('../src/projects.ts');
  const seen: string[] = [];
  importCompany('u-roles', { format: 'openkrishbot-company-v1', name: 'Roles Co', bots: [{ name: 'A', role: 'r', goal: 'G', backstory: 'B', instructions: 'I' }] }, (b) => { seen.push(b.instructions); return 'id'; });
  assert.deepEqual(seen, ['Your goal: G\n\nBackground: B\n\nI']);
});
