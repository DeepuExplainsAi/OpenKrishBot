import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { libraryRoot } from './paths.js';
import { getBotRow } from './store.js';
import { requireUser, type AuthVars } from './lib/auth.js';

/** Websites a bot builds: any folder under its Library (default `site/`) is served at /sites/<botId>/<folder>/ on this computer. Only the owner can open it. */
export const sitesApi = new Hono<AuthVars>();
sitesApi.use('*', requireUser);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};

/** Resolve a request path inside a bot's Library; null when it escapes the folder. */
export function siteFile(botId: string, rel: string): string | null {
  const root = path.resolve(libraryRoot(), botId);
  let target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch { return null; }
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

/** Folders in the bot's Library that hold an index.html. */
export function listSites(botId: string): string[] {
  const root = path.join(libraryRoot(), botId);
  try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'index.html'))).map((d) => d.name); } catch { return []; }
}

sitesApi.get('/:botId/*', (c) => {
  const botId = c.req.param('botId');
  const bot = getBotRow(botId);
  if (!bot || bot.user_id !== c.get('user').id) return c.text('Not found', 404);
  const rel = decodeURIComponent(c.req.path.split('/').slice(3).join('/'));
  const file = siteFile(botId, rel);
  if (!file) return c.text('Not found', 404);
  return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-security-policy': "sandbox allow-scripts allow-forms allow-popups", 'x-content-type-options': 'nosniff' } });
});

sitesApi.get('/:botId', (c) => c.redirect(`/sites/${c.req.param('botId')}/site/`));
