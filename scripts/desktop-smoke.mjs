// Runs the packaged server with the app's own Node runtime (Electron as Node) and checks /api/health.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rel = path.resolve('release');
const unpacked = fs.readdirSync(rel).filter((n) => /unpacked$|^mac/.test(n)).map((n) => path.join(rel, n))[0];
const exe = process.platform === 'win32' ? path.join(unpacked, 'Krishbot.exe')
  : process.platform === 'darwin' ? path.join(unpacked, 'Krishbot.app/Contents/MacOS/Krishbot')
  : path.join(unpacked, 'krishbot-desktop');
const resources = process.platform === 'darwin' ? path.join(unpacked, 'Krishbot.app/Contents/Resources/app') : path.join(unpacked, 'resources/app');
const app = fs.existsSync(resources) ? resources : path.resolve('.');
const port = 18999;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-smoke-'));
const p = spawn(exe, [path.join(app, 'server/dist/index.js')], { cwd: path.join(app, 'server'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOME: home, USERPROFILE: home }, stdio: 'inherit' });
let ok = false;
for (let i = 0; i < 60 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ok = await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false);
}
p.kill();
if (!ok) { console.error('Packaged server did not answer /api/health'); process.exit(1); }
console.log('packaged server OK');
