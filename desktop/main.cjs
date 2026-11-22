// OpenKrishBot desktop shell: starts the local server (same code as `npm start`) and shows it in a window.
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

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
  server.on('exit', (code) => { server = null; if (code && !app.isQuitting) { console.error('OpenKrishBot server stopped, code', code); app.quit(); } });
  for (let i = 0; i < 120; i++) { if (await healthy(port)) return port; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('The OpenKrishBot server did not start.');
}

async function open() {
  const port = await start();
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 420, minHeight: 600, title: 'OpenKrishBot', backgroundColor: '#ffffff', show: false,
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  // links to other sites open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission)));
  await win.loadURL(`http://127.0.0.1:${port}`);
  win.on('closed', () => { win = null; });
}

// ---- updates: the same kind of install updates itself (Windows Setup, Linux AppImage/deb); Mac and Windows Portable download the new file and open it ----
autoUpdater.autoDownload = false;
autoUpdater.logger = { info() {}, warn() {}, error: (m) => fs.writeSync(logFd, `updater: ${m}\n`), debug() {} };
const selfUpdates = () => (process.platform === 'win32' ? !process.env.PORTABLE_EXECUTABLE_FILE : process.platform === 'linux');
const progress = (f) => win?.setProgressBar(f);

async function downloadAndOpen(version) {
  const rel = await (await fetch(`https://api.github.com/repos/DeepuExplainsAi/krishbot-ai/releases/tags/v${version}`, { headers: { 'user-agent': 'OpenKrishBot' } })).json();
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
ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:check', () => checkForUpdate(true));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
    return open().then(() => { if (app.isPackaged) setTimeout(() => checkForUpdate(true), 15000); });
  }).catch((e) => {
    dialog.showErrorBox('OpenKrishBot could not start', `${e?.message ?? e}\n\nDetails: ${logFile}`);
    app.quit();
  });
  app.on('activate', () => { if (!win && app.isReady()) open().catch(() => {}); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { app.isQuitting = true; server?.kill(); });
}
