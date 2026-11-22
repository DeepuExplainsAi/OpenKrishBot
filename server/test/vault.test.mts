import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.KRISH_VAULT_KEY_DIR = home;
process.env.DB_PATH = path.join(home, 'x.db');
await import('../src/db-config.js');
const { db } = await import('../src/db.js');
const { initRooms } = await import('../src/agent/rooms.js');
const { initSubagents } = await import('../src/agent/subagents.js');
initRooms(); initSubagents();
const v = await import('../src/vault.js');
const { createBot } = await import('../src/routes.js');
const P = await import('../src/projects.js');
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u','u@x','U',1)").run();

test('values are encrypted at rest and never listed', () => {
  const r = v.saveSecret('u', { name: 'shop', value: 'TOPSECRET-123456', origin: 'http://127.0.0.1:1', auth: 'bearer' });
  assert.ok(!('error' in r));
  assert.ok(!JSON.stringify(v.listVault('u')).includes('TOPSECRET'));
  const raw = (db.prepare("SELECT value FROM vault WHERE name='shop'").get() as any).value as Buffer;
  assert.ok(!raw.toString('utf8').includes('TOPSECRET'));
  assert.equal(v.secretValue('u', 'SHOP')?.value, 'TOPSECRET-123456');
});
test('bad names/origins are refused', () => {
  assert.ok('error' in v.saveSecret('u', { name: 'Bad Name', value: 'x', origin: 'https://a.com' }));
  assert.ok('error' in v.saveSecret('u', { name: 'ok', value: 'x', origin: 'http://evil.com' }));
});
test('secret_request injects the key only for the saved origin, hides echoes, does not follow redirects', async () => {
  const seen: string[] = [];
  const srv = http.createServer((req, res) => {
    seen.push(String(req.headers.authorization));
    if (req.url === '/redir') { res.writeHead(302, { location: 'http://example.com/' }); return res.end(); }
    res.end(`you sent ${req.headers.authorization}`);
  }).listen(0);
  const port = (srv.address() as any).port;
  v.saveSecret('u', { name: 'local', value: 'KEY-abcdef-123', origin: `http://127.0.0.1:${port}`, auth: 'bearer' });
  const ok = JSON.parse(await v.secretRequest('u', { name: 'local', url: `http://127.0.0.1:${port}/x` }));
  assert.equal(ok.status, 200);
  assert.equal(seen[0], 'Bearer KEY-abcdef-123');
  assert.ok(!ok.body.includes('KEY-abcdef'));
  assert.match(JSON.parse(await v.secretRequest('u', { name: 'local', url: 'http://127.0.0.1:1/x' })).error, /may only be used at/);
  assert.equal(JSON.parse(await v.secretRequest('u', { name: 'local', url: `http://127.0.0.1:${port}/redir` })).status, 302);
  srv.close();
});
test('scrubVault hides plain, base64 and url-encoded forms', () => {
  v.saveSecret('u', { name: 'pw', value: 'p@ss word!!', auth: 'login', username: 'me', origin: 'https://shop.example.com' });
  const t = `a p@ss word!! b ${Buffer.from('p@ss word!!').toString('base64')} c ${encodeURIComponent('p@ss word!!')}`;
  assert.ok(!/p@ss|cEBzcy|p%40ss/.test(v.scrubVault('u', t)));
});

test('company: export has no secrets or chats; import recreates bots in a new company', () => {
  const hire = (b: any) => createBot('u', b).id;
  const id = P.companyByName('u', 'Dropship Co', 'Sell things');
  assert.equal(P.companyByName('u', 'dropship co'), id);
  const bot = createBot('u', { name: 'Amazon Lister', label: 'Dropship Co · Amazon', description: 'Amazon', instructions: 'List products' });
  P.assignBot('u', bot.id, id);
  const ex = P.exportCompany('u', id)!;
  assert.equal(ex.bots.length, 1);
  assert.ok(!JSON.stringify(ex).includes('TOPSECRET'));
  const imp = P.importCompany('u', ex, hire) as any;
  assert.equal(imp.name, 'Dropship Co (imported)');
  assert.equal(imp.botIds.length, 1);
  assert.equal((db.prepare('SELECT name FROM bots WHERE id=?').get(imp.botIds[0]) as any).name, 'Amazon Lister 2');
  assert.ok('error' in (P.importCompany('u', { nope: 1 }, hire) as any));
});

test('login needs a site; rebinding needs the value again; export scrubs vault values', () => {
  assert.ok('error' in v.saveSecret('u', { name: 'nosite', value: 'x', auth: 'login' }));
  assert.ok('error' in v.saveSecret('u', { name: 'pw', origin: 'https://evil.example.com' }));
  assert.ok(!('error' in v.saveSecret('u', { name: 'pw', username: 'me2' })));
  const id = P.companyByName('u', 'Leaky', '');
  const b = createBot('u', { name: 'Leaky Bot', label: 'x', description: 'x', instructions: 'password is p@ss word!! ok' });
  P.assignBot('u', b.id, id);
  assert.ok(!JSON.stringify(P.exportCompany('u', id)).includes('p@ss word!!'));
});
