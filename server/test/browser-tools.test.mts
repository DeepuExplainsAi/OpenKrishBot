import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from '../src/screen/cdp.ts';

const PAGE = `<html><head><title>Shop</title></head><body><a href="/two" id="l">Go two</a>
<select id="s"><option value="a">Apple</option><option value="b">Banana</option></select>
<input type="file" id="f"><div id="out"></div>
<script>document.getElementById('s').onchange = (e) => document.getElementById('out').textContent = 'picked ' + e.target.value;
setTimeout(() => { document.getElementById('out').textContent += ' ready'; }, 700);</script></body></html>`;

test('browser tools: navigate, select, upload, wait, tabs, read', { skip: (!findChrome() && 'no Chrome installed') || (process.env.OPENKRISHBOT_BROWSER_TEST !== '1' && 'set OPENKRISHBOT_BROWSER_TEST=1 to run against a real Chrome') }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'okb-'));
  process.env.HOME = home;
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
    assert.match(await run('browser_wait', { text: 'picked b ready', seconds: 5 }), /picked b ready/);
    assert.match(await run('browser_upload', { index: idx(/\[(\d+)\] input:file/), path: 'a.txt' }), /Attached a\.txt/);
    assert.match(await run('browser_read'), /# Shop/);
    await run('browser_tabs', { action: 'new', url: base });
    assert.equal((await run('browser_tabs', { action: 'list' })).split('\n').length, 2);
  } finally { closeAllScreens(); srv.close(); }
});
