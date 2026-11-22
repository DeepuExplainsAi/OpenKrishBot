import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = `/tmp/p37-test-${process.pid}.db`;
process.env.KRISH_VAULT_KEY_DIR = `/tmp/p37-key-${process.pid}`;
await import('../src/db-config.js');
const { applyEdits } = await import('../src/agent/loop.ts');
const { extractEmpty } = await import('../src/screen/extract.ts');
const { scrubVault } = await import('../src/vault.ts');
import fs from 'node:fs';

test('edits change only existing plain values of the same type', () => {
  const a: any = { to: 'a@x.com', n: 3, nested: { x: 1 }, on: true };
  applyEdits(a, { to: 'b@x.com', n: '9', nested: 'oops', extra: 'new', on: false });
  assert.deepEqual(a, { to: 'b@x.com', n: 3, nested: { x: 1 }, on: false });
});

test('extractEmpty spots a layout that no longer matches', () => {
  assert.ok(extractEmpty([]));
  assert.ok(extractEmpty({ a: null, b: null }));
  assert.ok(!extractEmpty([{ a: 'x' }]));
  assert.ok(!extractEmpty({ a: 'x', b: null }));
});

test('the vault key itself never reaches the model', () => {
  scrubVault('u', 'x');
  const key = fs.readFileSync(`/tmp/p37-key-${process.pid}/vault.key`, 'utf8').trim();
  assert.ok(!scrubVault('u', `cat gave ${key}`).includes(key));
});
