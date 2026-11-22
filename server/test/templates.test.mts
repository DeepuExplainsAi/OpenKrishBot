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
