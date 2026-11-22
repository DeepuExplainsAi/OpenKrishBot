// One command to run Krishbot on this computer: installs and builds on first run, starts the server, opens the browser.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '8787';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) => {
  const r = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`\nKrishbot could not finish "npm ${args.join(' ')}". Fix the error above and run this again.`); process.exit(1); }
};

if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Krishbot needs Node.js 22 or newer: https://nodejs.org'); process.exit(1); }
if (!fs.existsSync(path.join(root, 'node_modules'))) { console.log('First run: installing (a few minutes)…'); run(['install']); }
if (!fs.existsSync(path.join(root, 'web/dist/index.html')) || !fs.existsSync(path.join(root, 'server/dist/index.js')) || process.argv.includes('--rebuild')) { console.log('Building the app…'); run(['run', 'build']); }

const server = spawn(process.execPath, ['dist/index.js'], { cwd: path.join(root, 'server'), stdio: 'inherit', env: { ...process.env, PORT: port } });
server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => server.kill());

const url = `http://localhost:${port}`;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await fetch(`${url}/api/health`).then((r) => r.ok, () => false)) break;
}
console.log(`\nKrishbot is running at ${url}  (Ctrl+C to stop)`);
const open = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
spawn(open[0], open[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
