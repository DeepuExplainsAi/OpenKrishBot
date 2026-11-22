// OpenKrishbot desktop shell: starts the local server (same code as `npm start`) and shows it in a window.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const PREFERRED_PORT = Number(process.env.PORT) || 8787;
let server = null;
const logFile = path.join(os.homedir(), '.krishbot', 'desktop.log');
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
  // a OpenKrishbot already running on the preferred port (e.g. from the terminal) is reused
  if (await healthy(PREFERRED_PORT)) return PREFERRED_PORT;
  const port = await freePort(PREFERRED_PORT);
  server = spawn(process.execPath, [path.join(__dirname, 'server', 'dist', 'index.js')], {
    cwd: path.join(__dirname, 'server'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOST: process.env.HOST || '127.0.0.1' },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  server.on('exit', (code) => { server = null; if (code && !app.isQuitting) { console.error('OpenKrishbot server stopped, code', code); app.quit(); } });
  for (let i = 0; i < 120; i++) { if (await healthy(port)) return port; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('The OpenKrishbot server did not start.');
}

async function open() {
  const port = await start();
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 420, minHeight: 600, title: 'OpenKrishbot', backgroundColor: '#ffffff', show: false,
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  // links to other sites open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission)));
  await win.loadURL(`http://127.0.0.1:${port}`);
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
    return open();
  }).catch((e) => {
    dialog.showErrorBox('OpenKrishbot could not start', `${e?.message ?? e}\n\nDetails: ${logFile}`);
    app.quit();
  });
  app.on('activate', () => { if (!win && app.isReady()) open().catch(() => {}); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { app.isQuitting = true; server?.kill(); });
}
