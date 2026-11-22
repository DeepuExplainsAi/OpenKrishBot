import test from 'node:test';
import assert from 'node:assert/strict';
const { launchEnv, launchCommand } = await import('../src/lib/launch.js');

test('launchEnv keeps the existing PATH first and adds the usual tool folders once', () => {
  const old = process.env.PATH;
  process.env.PATH = process.platform === 'win32' ? 'C:\\Windows' : '/usr/bin';
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts = launchEnv().PATH.split(sep);
  assert.equal(parts[0], process.env.PATH.split(sep)[0]);
  assert.equal(new Set(parts).size, parts.length);
  if (process.platform !== 'win32') assert.ok(parts.includes('/usr/local/bin') && parts.includes('/opt/homebrew/bin'));
  process.env.PATH = old;
});
test('launchEnv passes extra variables through', () => {
  assert.equal(launchEnv({ FOO: 'bar' }).FOO, 'bar');
});
test('npx is only renamed on Windows', () => {
  assert.equal(launchCommand('node'), 'node');
  assert.equal(launchCommand('npx'), process.platform === 'win32' ? 'npx.cmd' : 'npx');
});
