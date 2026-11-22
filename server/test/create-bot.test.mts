import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.DB_PATH = path.join(home, 'x.db');
await import('../src/db-config.js');
const { db } = await import('../src/db.js');
const { TOOLS } = await import('../src/agent/tools.js');
const { initRooms } = await import('../src/agent/rooms.js');
initRooms();
const { initSubagents } = await import('../src/agent/subagents.js');
initSubagents();
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1)").run();
const ctx = { userId: 'u', botId: 'none', enqueueBotMessage: () => {}, depth: 0 } as any;
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;

test('create_bot hires a Bot with company + role, rejects duplicates, list_bots shows it', async () => {
  const r = JSON.parse((await tool('create_bot').impl({ name: 'Amazon Lister', role: 'Amazon listing', company: 'Dropship Co', instructions: 'List products' }, ctx)).output);
  assert.equal(r.ok, true);
  const row = db.prepare("SELECT label, instructions FROM bots WHERE name='Amazon Lister'").get() as any;
  assert.equal(row.label, 'Dropship Co · Amazon listing');
  assert.match(row.instructions, /Dropship Co team/);
  assert.match((await tool('create_bot').impl({ name: 'amazon lister', instructions: 'x' }, ctx)).output, /already exists/);
  assert.match((await tool('list_bots').impl({}, ctx)).output, /Amazon Lister \(Dropship Co · Amazon listing\)/);
});
