// OpenKrishBot desktop shell: starts the local server (same code as `npm start`) and shows it in a window.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

process.on('uncaughtException', (e) => { try { fs.writeSync(logFd, `uncaught: ${e?.stack ?? e}\n`); } catch {} });
process.on('unhandledRejection', (e) => { try { fs.writeSync(logFd, `unhandled: ${e?.stack ?? e}\n`); } catch {} });
const PREFERRED_PORT = Number(process.env.PORT) || 8787;
let server = null;
const logFile = path.join(os.homedir(), '.openkrishbot', 'desktop.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const logFd = fs.openSync(logFile, 'w');
let win = null;

const freePort = (port) => new Promise((resolve) => {
  const t = net.createServer().once('error', () => net.createServer().once('listening', function () { const p = this.address().port; this.close(() => resolve(p)); }).listen(0, '127.0.0.1'))
    .once('listening', () => t.close(() => resolve(port)));
  t.listen(port, '127.0.0.1');
});

async function healthy(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

async function start() {
  // a OpenKrishBot already running on the preferred port (e.g. from the terminal) is reused
  if (await healthy(PREFERRED_PORT)) return PREFERRED_PORT;
  const port = await freePort(PREFERRED_PORT);
  server = spawn(process.execPath, [path.join(__dirname, 'server', 'dist', 'index.js')], {
    cwd: path.join(__dirname, 'server'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOST: process.env.HOST || '127.0.0.1' },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  server.on('error', (e) => { dialog.showErrorBox('OpenKrishBot could not start', `${e.message}\n\nDetails: ${logFile}`); app.quit(); });
  server.on('exit', (code) => {
    server = null;
    if (code && !app.isQuitting) {
      let tail = ''; try { tail = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-8).join('\n'); } catch {}
      dialog.showErrorBox('OpenKrishBot stopped', `The engine exited (code ${code}).\n\n${tail}\n\nFull log: ${logFile}`);
      app.quit();
    }
  });
  for (let i = 0; i < 120; i++) { if (await healthy(port)) return port; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('The OpenKrishBot server did not start.');
}

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="96" height="96"><circle cx="256" cy="256" r="244" fill="#000"/><g stroke="#fff" stroke-width="44" stroke-linecap="round"><line x1="196" y1="296" x2="226" y2="206"/><line x1="286" y1="206" x2="316" y2="296"/></g></svg>';
// dark splash with the logo only (no text: a data URL without a charset showed "â€¦" garbage); charset is declared
const LOADING = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>OpenKrishBot</title><style>html,body{margin:0;height:100%;background:#121212}body{display:grid;place-items:center}svg{border-radius:50%;box-shadow:0 0 0 1px #2a2a2a;animation:b 2.4s ease-in-out infinite}@keyframes b{50%{transform:translateY(-6px)}}</style>${LOGO}`);

async function open() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 420, minHeight: 600, title: 'OpenKrishBot', backgroundColor: '#121212', show: true,
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  // links to other sites open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('data:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission)));
  win.on('closed', () => { win = null; });
  // a crashed or failed page reloads itself, at most 5 times in a row, then shows a clear message instead of a blank window
  let recoveries = 0;
  const giveUp = (why) => { if (win) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#121212;color:#c8ccd4;font:15px system-ui;text-align:center">${LOGO}<p>OpenKrishBot could not show its window (${why}).<br>Close and open it again. Log: ${logFile.replace(/[<&]/g, '')}</p></body>`)).catch(() => {}); };
  const recover = (why, url) => { if (!win || app.isQuitting) return; if (++recoveries > 5) return giveUp(why); setTimeout(() => (url ? win?.loadURL(url) : win?.reload())?.catch?.(() => {}), 1000); };
  win.webContents.on('did-finish-load', () => { if (win?.webContents.getURL().startsWith('http')) recoveries = 0; });
  win.webContents.on('render-process-gone', (_e, d) => recover(`renderer ${d.reason}`));
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3 && url.startsWith('http')) recover(desc, url); });
  win.loadURL(LOADING);
  const port = await start();
  await win?.loadURL(`http://127.0.0.1:${port}`).catch(() => {}); // a failed first load is retried by did-fail-load above
}

// ---- updates: the same kind of install updates itself (Windows Setup, Linux AppImage/deb); Mac and Windows Portable download the new file and open it ----
autoUpdater.autoDownload = false;
autoUpdater.logger = { info() {}, warn() {}, error: (m) => fs.writeSync(logFd, `updater: ${m}\n`), debug() {} };
const selfUpdates = () => (process.platform === 'win32' ? !process.env.PORTABLE_EXECUTABLE_FILE : process.platform === 'linux');
const progress = (f) => win?.setProgressBar(f);

async function downloadAndOpen(version) {
  const rel = await (await fetch(`https://api.github.com/repos/DeepuExplainsAi/OpenKrishBot/releases/tags/v${version}`, { headers: { 'user-agent': 'OpenKrishBot' } })).json();
  const pick = process.platform === 'darwin' ? `mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg` : 'Portable-';
  const asset = (rel.assets ?? []).find((a) => a.name.includes(pick));
  if (!asset) throw new Error('No matching file in the release');
  const dest = path.join(app.getPath('downloads'), asset.name);
  const res = await fetch(asset.browser_download_url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0; let got = 0;
  const out = fs.createWriteStream(dest);
  for await (const chunk of res.body) { out.write(chunk); got += chunk.length; if (total) progress(got / total); }
  await new Promise((r) => out.end(r));
  progress(-1);
  await shell.openPath(dest);
  return dest;
}

let checking = false;
/** Ask the release page for a newer version; with `ask`, offer to install it. Returns a short status for the UI. */
async function checkForUpdate(ask) {
  if (checking) return { status: 'busy' };
  if (!app.isPackaged) return { status: 'dev' };
  checking = true;
  try {
    const r = await autoUpdater.checkForUpdates();
    const next = r?.updateInfo?.version;
    if (!next || !r.isUpdateAvailable) return { status: 'current', version: app.getVersion() };
    if (ask) {
      const { response } = await dialog.showMessageBox(win, { type: 'info', buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1, title: 'Update available', message: `OpenKrishBot ${next} is available (you have ${app.getVersion()}).`, detail: 'Your bots, chats and settings stay as they are.' });
      if (response !== 0) return { status: 'later', version: next };
    }
    if (selfUpdates()) {
      autoUpdater.on('download-progress', (p) => progress(p.percent / 100));
      await autoUpdater.downloadUpdate();
      progress(-1);
      const { response } = await dialog.showMessageBox(win, { type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, title: 'Update ready', message: `OpenKrishBot ${next} is downloaded.`, detail: 'Restart to finish the update.' });
      if (response === 0) { app.isQuitting = true; server?.kill(); autoUpdater.quitAndInstall(); }
      return { status: 'ready', version: next };
    }
    await downloadAndOpen(next);
    await dialog.showMessageBox(win, { type: 'info', buttons: ['OK'], message: process.platform === 'darwin' ? 'The new version is in your Downloads and opened. Drag OpenKrishBot to Applications (replace), then restart.' : 'The new version was downloaded and started. Close this window to finish.' });
    return { status: 'downloaded', version: next };
  } catch (e) {
    progress(-1);
    return { status: 'error', error: String(e?.message ?? e) };
  } finally { checking = false; }
}
// nod's update status for the in-app toast: download in the background, offer "Restart to update", install on quit otherwise.
const upd = { phase: 'idle', checking: false, readyVersion: undefined, dismissedVersion: undefined, failure: undefined, progress: undefined };
let failureId = 0;
const pushStatus = () => win?.webContents.send('update:status', { ...upd });
const fail = (phase, e) => { upd.failure = { id: ++failureId, phase, message: String(e?.message ?? e) }; upd.checking = false; upd.phase = 'idle'; pushStatus(); };
async function prepareUpdate() {
  if (!app.isPackaged || upd.checking) return;
  upd.checking = true; upd.phase = 'checking'; upd.failure = undefined; pushStatus();
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!r?.isUpdateAvailable) { upd.checking = false; upd.phase = 'idle'; return pushStatus(); }
    const next = r.updateInfo.version;
    if (!selfUpdates()) { upd.checking = false; upd.phase = 'idle'; upd.readyVersion = undefined; upd.failure = { id: ++failureId, phase: 'downloading', message: `OpenKrishBot ${next} is available. Download it from the release page.` }; return pushStatus(); }
    upd.phase = 'downloading'; pushStatus();
    autoUpdater.autoInstallOnAppQuit = true;
    await autoUpdater.downloadUpdate();
    upd.checking = false; upd.phase = 'ready'; upd.readyVersion = next; pushStatus();
  } catch (e) { fail(upd.phase === 'downloading' ? 'downloading' : 'checking', e); }
}
ipcMain.handle('update:status', () => ({ ...upd }));
ipcMain.handle('update:dismiss', (_e, v) => { if (typeof v === 'number') { if (upd.failure?.id === v) upd.failure.dismissed = true; } else upd.dismissedVersion = v; pushStatus(); });
ipcMain.handle('update:retry', () => prepareUpdate());
ipcMain.handle('update:download', () => shell.openExternal('https://github.com/DeepuExplainsAi/OpenKrishBot/releases/latest'));
ipcMain.handle('update:restart', () => { try { app.isQuitting = true; server?.kill(); autoUpdater.quitAndInstall(); } catch (e) { fail('restart', e); throw e; } });
ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:check', () => checkForUpdate(true));

if (!app.requestSingleInstanceLock()) app.quit(); // the running copy is brought to the front below
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else open().catch(() => {}); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
    return open().then(() => { if (app.isPackaged) setTimeout(() => prepareUpdate(), 15000); });
  }).catch((e) => {
    dialog.showErrorBox('OpenKrishBot could not start', `${e?.message ?? e}\n\nDetails: ${logFile}`);
    app.quit();
  });
  app.on('activate', () => { if (!win && app.isReady()) open().catch(() => {}); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { app.isQuitting = true; server?.kill(); });
}
