// Runs the packaged server with the app's own Node runtime (Electron as Node) and checks /api/health.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rel = path.resolve('release');
const dirs = fs.readdirSync(rel).filter((n) => /unpacked$|^mac/.test(n));
console.log('release dirs:', dirs.join(', '));
// electron-builder makes `mac` (x64) and `mac-arm64`: run the one that matches this machine
const pick = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac') : dirs[0];
const unpacked = path.join(rel, dirs.includes(pick) ? pick : dirs[0]);
const exe = process.platform === 'win32' ? path.join(unpacked, 'OpenKrishBot.exe')
  : process.platform === 'darwin' ? path.join(unpacked, 'OpenKrishBot.app/Contents/MacOS/OpenKrishBot')
  : path.join(unpacked, 'openkrishbot-desktop');
const resources = process.platform === 'darwin' ? path.join(unpacked, 'OpenKrishBot.app/Contents/Resources/app') : path.join(unpacked, 'resources/app');
const found = fs.existsSync(resources) ? resources : path.resolve('.');
// run from a copy outside the repo, so a library missing from the package is not found in the repo's node_modules
const app = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-app-')), 'app');
fs.cpSync(found, app, { recursive: true });
const port = 18999;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-smoke-'));
const p = spawn(exe, [path.join(app, 'server/dist/index.js')], { cwd: path.join(app, 'server'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOME: home, USERPROFILE: home }, stdio: 'inherit' });
let exited = null;
p.on('exit', (code, sig) => { exited = `code ${code} signal ${sig}`; });
p.on('error', (e) => { exited = `spawn error ${e.message}`; });
console.log('running', exe, 'app', app);
let ok = false;
for (let i = 0; i < 60 && !ok && !exited; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ok = await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false);
}
p.kill();
if (!ok) { console.error('Packaged server did not answer /api/health', exited ?? '(still running)'); process.exit(1); }
console.log('packaged server OK');
