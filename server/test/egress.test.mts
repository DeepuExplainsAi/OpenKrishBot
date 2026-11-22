import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPrivateIp, assertPublicUrl } from '../src/lib/egress.ts';
import { fetchPage } from '../src/krish/scrape.ts';

test('isPrivateIp', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});

test('assertPublicUrl blocks local targets and non-http', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1:8787/api/auth/me'), /Blocked/);
  await assert.rejects(assertPublicUrl('http://localhost/'), /Blocked/);
  await assert.rejects(assertPublicUrl('http://[::1]/'), /Blocked/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), /Blocked/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /Only http/);
});

test('fetchPage publicOnly refuses a local server', async () => {
  let hit = false;
  const srv = http.createServer((_q, res) => { hit = true; res.end('x'); }).listen(0);
  try {
    await assert.rejects(fetchPage(`http://127.0.0.1:${(srv.address() as any).port}/`, { publicOnly: true }), /Blocked/);
    assert.equal(hit, false);
  } finally { srv.close(); }
});
