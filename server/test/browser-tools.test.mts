import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/screen/cdp.ts';

const PAGE = `<html><head><title>Shop</title></head><body><a href="/two" id="l">Go two</a>
<select id="s"><option value="a">Apple</option><option value="b">Banana</option></select>
<input type="file" id="f"><div id="out"></div><div id="late"></div>
<script>document.getElementById('s').onchange = (e) => document.getElementById('out').textContent = 'picked ' + e.target.value;
console.log('hello-log');
setTimeout(() => { document.getElementById('late').textContent = 'late-ready'; }, 700);</script></body></html>`;

test('browser tools: navigate, select, upload, wait, tabs, read', { skip: (!findChrome() && 'no Chrome installed') || (process.platform === 'darwin' && !!process.env.CI && 'headless Chrome hangs on the macOS CI runner') || (process.env.OPENKRISHBOT_BROWSER_TEST !== '1' && !process.env.CI && 'runs in CI, or locally with OPENKRISHBOT_BROWSER_TEST=1') }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okb-'));
  process.env.HOME = process.env.USERPROFILE = home;
  const { BROWSER_TOOLS } = await import('../src/screen/tools.ts');
  const { closeAllScreens } = await import('../src/screen/manager.ts');
  const srv = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGE); }).listen(0);
  const base = `http://127.0.0.1:${(srv.address() as any).port}/`;
  const botHome = path.join(home, 'bots', 'bot_t'); fs.mkdirSync(path.join(botHome, 'work'), { recursive: true });
  fs.writeFileSync(path.join(botHome, 'work', 'a.txt'), 'hi');
  const run = (name: string, args: any = {}) => BROWSER_TOOLS.find((t) => t.name === name)!.run(args, { home: botHome, cwd: path.join(botHome, 'work') });
  try {
    const nav = await run('browser_navigate', { url: base });
    assert.match(nav, /select/);
    const idx = (re: RegExp) => Number(re.exec(nav)![1]);
    await run('browser_select', { index: idx(/\[(\d+)\] select/), option: 'Banana' });
    assert.match(await run('browser_wait', { text: 'late-ready', seconds: 10 }), /late-ready/);
    assert.match(await run('browser_snapshot'), /picked b/);
    assert.match(await run('browser_upload', { index: idx(/\[(\d+)\] input:file/), path: 'a.txt' }), /Attached a\.txt/);
    assert.match(await run('browser_read'), /# Shop/);
    assert.deepEqual(JSON.parse(await run('browser_extract', { each: 'option', fields: { name: '', value: '@value' } })).map((r: any) => r.name), ['Apple', 'Banana']);
    assert.match(await run('browser_console'), /hello-log/);
    assert.match(await run('browser_network', { filter: '127.0.0.1' }), /GET 200/);
    assert.match(await run('browser_resize', { width: 390, height: 844 }), /390x844/);
    assert.match(await run('browser_pdf', { name: 'shop' }), /shop\.pdf/);
    await run('browser_tabs', { action: 'new', url: base });
    assert.equal((await run('browser_tabs', { action: 'list' })).split('\n').length, 2);
  } finally { closeAllScreens(); srv.close(); }
});
