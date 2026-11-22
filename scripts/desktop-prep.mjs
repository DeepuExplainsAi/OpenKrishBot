// Copies the built server + web app into desktop/ so electron-builder can package them (run after `npm run build`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = path.join(root, 'desktop');
for (const need of ['server/dist/index.js', 'web/dist/index.html']) if (!fs.existsSync(path.join(root, need))) { console.error(`Missing ${need}. Run "npm run build" first.`); process.exit(1); }
for (const p of ['server', 'web']) fs.rmSync(path.join(d, p), { recursive: true, force: true });
fs.mkdirSync(path.join(d, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'server/dist'), path.join(d, 'server/dist'), { recursive: true });
fs.cpSync(path.join(root, 'server/skills'), path.join(d, 'server/skills'), { recursive: true });
fs.copyFileSync(path.join(root, 'server/package.json'), path.join(d, 'server/package.json'));
fs.cpSync(path.join(root, 'web/dist'), path.join(d, 'web/dist'), { recursive: true });
console.log('desktop/ is ready');
