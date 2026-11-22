import fs from 'node:fs';
import path from 'node:path';
import { libraryRoot } from '../paths.js';
import type { LocalTool } from '../krish/tools.js';
import { screenOf } from './manager.js';
import { db } from '../db.js';
import { secretValue } from '../vault.js';
import { extractScript, stuckNote } from './extract.js';
import { htmlToMarkdown } from '../krish/scrape.js';

/** Browser tools for a bot (the OpenManus browser_use set): look at the page as a numbered list, then act on a number. */

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const botOf = (home: string) => path.basename(home);

const SNAPSHOT_JS = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[onclick],[contenteditable=true]';
  document.querySelectorAll('[data-kid]').forEach((e) => e.removeAttribute('data-kid'));
  const out = []; let i = 0;
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e)) continue;
    e.setAttribute('data-kid', String(i));
    const label = (e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || e.title || e.alt || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    const kind = e.tagName.toLowerCase() + (e.type && e.tagName === 'INPUT' ? ':' + e.type : '');
    out.push('[' + i + '] ' + kind + (label ? ' "' + label + '"' : '') + (e.tagName === 'A' ? ' -> ' + e.href.slice(0, 100) : ''));
    if (++i >= 120) break;
  }
  const text = (document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 3500);
  return { url: location.href, title: document.title, elements: out, text };
})()`;

async function snapshot(botId: string): Promise<string> {
  const s = await screenOf(botId);
  await new Promise((r) => setTimeout(r, 400));
  const v = await s.eval<{ url: string; title: string; elements: string[]; text: string }>(SNAPSHOT_JS);
  return `Page: ${v.title}\nURL: ${v.url}\n\nClickable / typeable (use the number):\n${v.elements.join('\n') || '(none)'}\n\nVisible text:\n${v.text}${stuckNote(botId, v.url + v.elements.join('|') + v.text.slice(0, 500))}`;
}

async function center(botId: string, index: number): Promise<{ x: number; y: number }> {
  const s = await screenOf(botId);
  const r = await s.eval<{ x: number; y: number } | null>(`(() => { const e = document.querySelector('[data-kid="${Number(index)}"]'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!r) throw new Error(`No element [${index}]. Run browser_snapshot again to get fresh numbers.`);
  return r;
}

async function click(botId: string, x: number, y: number) {
  const s = await screenOf(botId);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const KEYS: Record<string, { key: string; code: string; vk: number }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 }, Tab: { key: 'Tab', code: 'Tab', vk: 9 }, Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 }, PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
};

/** JPEG from the last browser_screenshot per bot; the engine hands it to vision models and clears it. */
const pendingShots = new Map<string, string>();
export const takeScreenshot = (botId: string) => { const b = pendingShots.get(botId); pendingShots.delete(botId); return b; };

export const BROWSER_TOOLS: LocalTool[] = [
  {
    name: 'browser_screenshot',
    description: 'Take a picture of the current page. Vision models see it directly; the file is also saved to your Library (screenshots/).',
    parameters: obj({}),
    async run(_a, c) {
      const id = botOf(c.home);
      const f = await (await screenOf(id)).shot();
      const dir = path.join(libraryRoot(), id, 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `shot-${Date.now()}.jpg`);
      fs.writeFileSync(file, f.jpeg);
      pendingShots.set(id, f.jpeg.toString('base64'));
      return `Screenshot saved to Library: screenshots/${path.basename(file)}. Models that can see images get it attached.`;
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open a URL in your own browser. Returns the page as a numbered list of things you can click or type into.',
    parameters: obj({ url: { type: 'string' } }, ['url']),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      const url = /^[a-z]+:/i.test(String(a.url)) ? String(a.url) : `https://${a.url}`;
      await s.send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, 1500));
      return snapshot(botOf(c.home));
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Look at the current page again: numbered clickable elements and the visible text.',
    parameters: obj({}),
    run: (_a, c) => snapshot(botOf(c.home)),
  },
  {
    name: 'browser_extract',
    description: 'Pull structured data out of the current page with CSS selectors, e.g. each="div.product", fields={"title":"h2","price":".price","link":"a@href"} (name@attr reads an attribute). Returns JSON rows. Cheaper and more exact than reading the whole page.',
    parameters: obj({ fields: { type: 'object', description: 'field name -> CSS selector' }, each: { type: 'string', description: 'CSS selector of the repeated row; omit for one record' } }, ['fields']),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      const out = await s.eval<unknown>(extractScript({ each: a.each ? String(a.each) : undefined, fields: a.fields as Record<string, string> }));
      const text = JSON.stringify(out, null, 1);
      return text.length > 20000 ? `${text.slice(0, 20000)}\n...(cut)` : text;
    },
  },
  {
    name: 'browser_click',
    description: 'Click the element with this number from the latest snapshot.',
    parameters: obj({ index: { type: 'number' } }, ['index']),
    async run(a, c) {
      const { x, y } = await center(botOf(c.home), a.index);
      await click(botOf(c.home), x, y);
      await new Promise((r) => setTimeout(r, 900));
      return snapshot(botOf(c.home));
    },
  },
  {
    name: 'browser_type',
    description: 'Click an input by its number and type text into it. Set submit=true to press Enter afterwards.',
    parameters: obj({ index: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' } }, ['index', 'text']),
    async run(a, c) {
      const id = botOf(c.home); const s = await screenOf(id);
      const { x, y } = await center(id, a.index);
      await click(id, x, y);
      await s.eval(`(() => { const e = document.activeElement; if (e && 'select' in e) e.select?.(); })()`);
      await s.send('Input.insertText', { text: String(a.text) });
      if (a.submit) await pressKey(id, 'Enter');
      await new Promise((r) => setTimeout(r, 900));
      return snapshot(id);
    },
  },
  {
    name: 'browser_fill_secret',
    description: "Type a vault secret into an input by its number (website login: username or password). You never see the value. The page's address must match the vault item's site if it has one.",
    parameters: obj({ index: { type: 'number' }, name: { type: 'string', description: 'vault item name' }, part: { type: 'string', description: "'password' (default) or 'username'" } }, ['index', 'name']),
    async run(a, c) {
      const id = botOf(c.home); const s = await screenOf(id);
      const userId = (db.prepare('SELECT user_id FROM bots WHERE id=?').get(id) as any)?.user_id;
      const v = userId ? secretValue(userId, String(a.name)) : null;
      if (!v) return JSON.stringify({ error: `No vault item "${a.name}". Use list_secrets.` });
      const text = a.part === 'username' ? v.item.username : v.value;
      if (!text) return JSON.stringify({ error: `"${v.item.name}" has no ${a.part === 'username' ? 'username' : 'value'} saved.` });
      if (v.item.auth !== 'login') return JSON.stringify({ error: `"${v.item.name}" is an API key; use secret_request.` });
      { const here = await s.eval<string>('location.origin'); if (here !== v.item.origin) return JSON.stringify({ error: `"${v.item.name}" may only be typed on ${v.item.origin}, this page is ${here}.` }); }
      const { x, y } = await center(id, a.index);
      await click(id, x, y);
      await s.eval(`(() => { const e = document.activeElement; if (e && 'select' in e) e.select?.(); })()`);
      await s.send('Input.insertText', { text });
      return `Typed the ${a.part === 'username' ? 'username' : 'password'} from "${v.item.name}" into field ${a.index}. Take a browser_snapshot to continue (the value is hidden).`;
    },
  },
  {
    name: 'browser_key',
    description: 'Press a key in the page: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, PageDown, PageUp.',
    parameters: obj({ key: { type: 'string' } }, ['key']),
    async run(a, c) { await pressKey(botOf(c.home), String(a.key)); await new Promise((r) => setTimeout(r, 600)); return snapshot(botOf(c.home)); },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page down or up by about one screen.',
    parameters: obj({ direction: { type: 'string', enum: ['down', 'up'] } }, ['direction']),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      await s.eval(`window.scrollBy(0, ${a.direction === 'up' ? -1 : 1} * innerHeight * 0.8)`);
      return snapshot(botOf(c.home));
    },
  },
  {
    name: 'browser_back',
    description: 'Go back one page.',
    parameters: obj({}),
    async run(_a, c) { const s = await screenOf(botOf(c.home)); await s.eval('history.back()'); await new Promise((r) => setTimeout(r, 1000)); return snapshot(botOf(c.home)); },
  },
  {
    name: 'browser_read',
    description: 'Read the current page (even behind a login) as clean Markdown with its links. Better than the snapshot for articles, docs and long pages.',
    parameters: obj({}),
    async run(_a, c) {
      const s = await screenOf(botOf(c.home));
      const html = await s.eval<string>('document.documentElement.outerHTML');
      const p = htmlToMarkdown(html, await s.eval<string>('location.href'));
      const out = `# ${p.title}\n\n${p.markdown}\n\nLinks:\n${p.links.join('\n')}`;
      return out.length > 15000 ? `${out.slice(0, 15000)}\n…[cut]` : out;
    },
  },
  {
    name: 'browser_tabs',
    description: "Manage your browser tabs. action: list, new (with url), select or close (with the tab's number from list).",
    parameters: obj({ action: { type: 'string', enum: ['list', 'new', 'select', 'close'] }, index: { type: 'number' }, url: { type: 'string' } }, ['action']),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      if (a.action === 'new') await s.openTab(/^[a-z]+:/i.test(String(a.url ?? '')) ? String(a.url) : `https://${a.url ?? 'about:blank'}`);
      else if (a.action === 'select' || a.action === 'close') {
        const t = (await s.tabs())[Number(a.index)];
        if (!t) throw new Error(`No tab ${a.index}. Use action list.`);
        if (a.action === 'select') await s.attach(t.id); else await s.closeTab(t.id);
      }
      await new Promise((r) => setTimeout(r, 500));
      return (await s.tabs()).map((t, i) => `${t.active ? '*' : ' '}[${i}] ${t.title || '(untitled)'} ${t.url}`).join('\n');
    },
  },
  {
    name: 'browser_hover',
    description: 'Move the mouse over the element with this number (opens hover menus).',
    parameters: obj({ index: { type: 'number' } }, ['index']),
    async run(a, c) {
      const id = botOf(c.home); const { x, y } = await center(id, a.index);
      await (await screenOf(id)).send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await new Promise((r) => setTimeout(r, 500));
      return snapshot(id);
    },
  },
  {
    name: 'browser_select',
    description: 'Choose an option in a dropdown (select element) by its number. Give the option text or value.',
    parameters: obj({ index: { type: 'number' }, option: { type: 'string' } }, ['index', 'option']),
    async run(a, c) {
      const id = botOf(c.home); const s = await screenOf(id);
      const ok = await s.eval<boolean>(`(() => { const e = document.querySelector('[data-kid="${Number(a.index)}"]'); if (!e || e.tagName !== 'SELECT') return false; const want = ${JSON.stringify(String(a.option))}.toLowerCase(); const o = [...e.options].find((x) => x.value.toLowerCase() === want || x.text.trim().toLowerCase() === want); if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      if (!ok) throw new Error('Not a dropdown, or no such option. Run browser_snapshot and check.');
      return snapshot(id);
    },
  },
  {
    name: 'browser_upload', ask: 'Upload a file from your computer to a website',
    description: 'Put a file from your computer into a file input (by its number). Path is absolute or relative to your workspace.',
    parameters: obj({ index: { type: 'number' }, path: { type: 'string' } }, ['index', 'path']),
    async run(a, c) {
      const id = botOf(c.home); const s = await screenOf(id);
      const file = path.resolve(path.join(c.home, 'work'), String(a.path));
      if (!fs.existsSync(file)) throw new Error(`No file at ${file}`);
      const r = await s.send('Runtime.evaluate', { expression: `document.querySelector('[data-kid="${Number(a.index)}"]')` });
      if (!r.result?.objectId) throw new Error(`No element [${a.index}]. Run browser_snapshot again.`);
      await s.send('DOM.setFileInputFiles', { files: [file], objectId: r.result.objectId });
      return `Attached ${path.basename(file)}.`;
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait until some text appears on the page, or just for a number of seconds (max 30).',
    parameters: obj({ text: { type: 'string' }, seconds: { type: 'number' } }),
    async run(a, c) {
      const id = botOf(c.home); const s = await screenOf(id);
      const end = Date.now() + Math.min(Number(a.seconds) || 10, 30) * 1000;
      if (a.text) {
        const q = JSON.stringify(String(a.text).toLowerCase());
        while (Date.now() < end && !(await s.eval<boolean>(`document.body.innerText.toLowerCase().includes(${q})`))) await new Promise((r) => setTimeout(r, 500));
      } else await new Promise((r) => setTimeout(r, Math.max(0, end - Date.now())));
      return snapshot(id);
    },
  },
  {
    name: 'browser_console',
    description: 'Messages and errors the current page wrote to its console (latest 50). Use to find out why a page is broken.',
    parameters: obj({ clear: { type: 'boolean' } }),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      const out = s.console.slice(-50).join('\n') || '(nothing logged)';
      if (a.clear) s.console = [];
      return out;
    },
  },
  {
    name: 'browser_network',
    description: 'Requests the page made (latest 50): method, status, URL. Optional filter text on the URL. Use to find the API a page calls.',
    parameters: obj({ filter: { type: 'string' } }),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      const f = a.filter ? String(a.filter).toLowerCase() : '';
      const rows = [...s.requests.values()].filter((r) => !f || r.url.toLowerCase().includes(f)).slice(-50);
      return rows.map((r) => `${r.method} ${r.status ?? '...'} ${r.type ?? ''} ${r.url.slice(0, 200)}`).join('\n') || '(no requests)';
    },
  },
  {
    name: 'browser_dialog',
    description: 'Answer a JavaScript alert / confirm / prompt that is blocking the page.',
    parameters: obj({ accept: { type: 'boolean' }, text: { type: 'string', description: 'answer for a prompt' } }, ['accept']),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      const was = s.dialog || '(none reported)';
      await s.send('Page.handleJavaScriptDialog', { accept: a.accept !== false, ...(a.text ? { promptText: String(a.text) } : {}) });
      s.dialog = '';
      return `Dialog ${a.accept !== false ? 'accepted' : 'dismissed'}: ${was}`;
    },
  },
  {
    name: 'browser_resize',
    description: 'Change the browser window size (e.g. 390x844 to see a phone layout).',
    parameters: obj({ width: { type: 'number' }, height: { type: 'number' } }, ['width', 'height']),
    async run(a, c) {
      const w = Math.min(Math.max(Number(a.width) || 0, 200), 3000), h = Math.min(Math.max(Number(a.height) || 0, 200), 3000);
      const s = await screenOf(botOf(c.home));
      await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      return `Window is now ${w}x${h}.`;
    },
  },
  {
    name: 'browser_drag',
    description: 'Drag the element with number `from` onto the element with number `to` (from the latest snapshot).',
    parameters: obj({ from: { type: 'number' }, to: { type: 'number' } }, ['from', 'to']),
    async run(a, c) {
      const id = botOf(c.home); const s = await screenOf(id);
      const p = await center(id, Number(a.from)); const q = await center(id, Number(a.to));
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 8; i++) await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (q.x - p.x) * i / 8, y: p.y + (q.y - p.y) * i / 8, button: 'left', buttons: 1 });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', clickCount: 1 });
      return snapshot(id);
    },
  },
  {
    name: 'browser_pdf',
    description: 'Save the current page as a PDF file in your library and return its path.',
    parameters: obj({ name: { type: 'string', description: 'file name without extension' } }),
    async run(a, c) {
      const s = await screenOf(botOf(c.home));
      const r = await s.send('Page.printToPDF', { printBackground: true });
      const dir = path.join(libraryRoot(), botOf(c.home), 'pdf');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${String(a.name || 'page').replace(/[^\w.-]+/g, '_')}.pdf`);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return `Saved ${file}`;
    },
  },
  {
    name: 'browser_eval', ask: 'Run a script inside the web page',
    description: 'Run JavaScript in the current page and return the result (JSON). For reading data the snapshot does not show.',
    parameters: obj({ script: { type: 'string' } }, ['script']),
    async run(a, c) { const s = await screenOf(botOf(c.home)); return JSON.stringify(await s.eval(String(a.script))).slice(0, 12000); },
  },
];

async function pressKey(botId: string, name: string) {
  const k = KEYS[name] ?? { key: name, code: name, vk: 0 };
  const s = await screenOf(botId);
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
