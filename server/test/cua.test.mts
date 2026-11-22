import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okb-cua-'));
process.env.HOME = process.env.USERPROFILE = home;
process.env.DB_PATH = path.join(home, 'test.db');
await import('../src/db-config.js');
const { cuaPath, cuaSupported } = await import('../src/cua.js');
const { CATALOG } = await import('../src/apps.js');

test('computer app is in the catalog and starts cua-driver over MCP', () => {
  const c = CATALOG.find((x) => x.slug === 'computer');
  assert.ok(c);
  assert.deepEqual(c.args, ['mcp']);
  assert.deepEqual(c.fields, []);
});

test('driver path is per version, inside the app folder, and only for supported platforms', () => {
  if (!cuaSupported()) return assert.equal(cuaPath(), undefined);
  assert.match(cuaPath()!.replaceAll('\\', '/'), /\.openkrishbot\/cua\/0\.41\.3\/cua-driver(\.exe)?$/);
});
