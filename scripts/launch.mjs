// One command to run OpenKrishBot on this computer: installs and builds on first run, starts the server, opens the browser.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '8787';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function openBrowser(url) {
  const open = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(open[0], open[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
const run = (args) => {
  const r = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`\nOpenKrishBot could not finish "npm ${args.join(' ')}". Fix the error above and run this again.`); process.exit(1); }
};

if (Number(process.versions.node.split('.')[0]) < 22) { console.error('OpenKrishBot needs Node.js 22 or newer: https://nodejs.org'); process.exit(1); }
if (!fs.existsSync(path.join(root, 'node_modules'))) { console.log('First run: installing (a few minutes)…'); run(['install']); }
if (!fs.existsSync(path.join(root, 'web/dist/index.html')) || !fs.existsSync(path.join(root, 'server/dist/index.js')) || process.argv.includes('--rebuild')) { console.log('Building the app…'); run(['run', 'build']); }

// A second double-click, or something else already on the port: say so instead of a stack trace.
const taken = await new Promise((resolve) => { const t = net.createServer().once('error', () => resolve(true)).once('listening', () => t.close(() => resolve(false))); t.listen(Number(port)); });
if (taken) {
  if (await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false)) {
    console.log(`OpenKrishBot is already running at http://localhost:${port}. Opening it.`);
    openBrowser(`http://localhost:${port}`);
    process.exit(0);
  }
  console.error(`Port ${port} is used by another program. Close it, or start OpenKrishBot on another port:\n  Windows: set PORT=8788 && OpenKrishBot.bat\n  Mac/Linux: PORT=8788 ./openkrishbot.sh`);
  process.exit(1);
}

const server = spawn(process.execPath, ['dist/index.js'], { cwd: path.join(root, 'server'), stdio: 'inherit', env: { ...process.env, PORT: port } });
server.on('exit', (code) => { if (code) console.error(`\nOpenKrishBot stopped with an error (code ${code}). The message above says why; if it mentions a missing module, delete the node_modules folder and start again.`); process.exit(code ?? 0); });
process.on('SIGINT', () => server.kill());

const url = `http://localhost:${port}`;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false)) break;
}
console.log(`\nOpenKrishBot is running at ${url}  (Ctrl+C to stop)`);
openBrowser(url);
