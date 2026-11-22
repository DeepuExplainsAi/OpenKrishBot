import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';

/**
 * Local vault (idea from Rakazo's bot secrets, Apache-2.0): the user saves logins and API keys by name.
 * Bots can list NAMES only. They use a value through `secret_request` (HTTP, sent only to the saved origin)
 * or `browser_fill_secret` (typed into a page); the value never enters the model's context.
 * Stored AES-256-GCM encrypted in the local database; the key is ~/.openkrishbot/vault.key (mode 600).
 */
db.exec(`CREATE TABLE IF NOT EXISTS vault (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, origin TEXT NOT NULL DEFAULT '', auth TEXT NOT NULL DEFAULT 'bearer',
  header TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', value BLOB NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
)`);

const keyFile = () => path.join(process.env.KRISH_VAULT_KEY_DIR ?? path.join(os.homedir(), '.openkrishbot'), 'vault.key');
let key: Buffer | null = null;
function vaultKey(): Buffer {
  if (key) return key;
  const f = keyFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) { try { fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); } catch { /* another start created it */ } }
  key = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  if (key.length !== 32) { key = null; throw new Error('vault.key is damaged'); }
  return key;
}
const seal = (text: string) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv); const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]); };
const open = (b: Buffer) => { const d = crypto.createDecipheriv('aes-256-gcm', vaultKey(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };

export type VaultAuth = 'bearer' | 'header' | 'basic' | 'login';
export interface VaultItem { id: string; name: string; origin: string; auth: VaultAuth; header: string; username: string; updatedAt: number }
const view = (r: any): VaultItem => ({ id: r.id, name: r.name, origin: r.origin, auth: r.auth, header: r.header, username: r.username, updatedAt: r.updated_at });
const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export const listVault = (userId: string) => (db.prepare('SELECT * FROM vault WHERE user_id=? ORDER BY name').all(userId) as any[]).map(view);

export function saveSecret(userId: string, a: { name?: string; value?: string; origin?: string; auth?: string; header?: string; username?: string }): VaultItem | { error: string } {
  const name = String(a.name ?? '').trim().toLowerCase();
  if (!NAME.test(name)) return { error: 'Name: lowercase letters, digits, - or _ (max 48).' };
  const old = db.prepare('SELECT * FROM vault WHERE user_id=? AND name=?').get(userId, name) as any;
  const auth = (['bearer', 'header', 'basic', 'login'].includes(String(a.auth)) ? a.auth : old?.auth ?? 'bearer') as VaultAuth;
  if (!a.value && !old) return { error: 'A value is needed.' };
  let origin = '';
  try {
    const u = new URL(String(a.origin ?? old?.origin ?? ''));
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) throw 0;
    origin = u.origin;
  } catch { return { error: 'Site must be an https:// address, like https://www.amazon.in (a key or login is only ever used on this site).' }; }
  if (old && !a.value && (origin !== old.origin || auth !== old.auth || (a.header !== undefined && a.header !== old.header))) return { error: 'To change the site or type, enter the value again.' };
  const header = auth === 'header' ? String(a.header ?? old?.header ?? '').trim() : '';
  if (auth === 'header' && !/^[A-Za-z0-9-]{1,60}$/.test(header)) return { error: 'Header name, like X-Api-Key.' };
  const username = String(a.username ?? old?.username ?? '').slice(0, 200);
  const value = a.value ? seal(a.value) : old.value;
  if (old) db.prepare('UPDATE vault SET origin=?,auth=?,header=?,username=?,value=?,updated_at=? WHERE id=?').run(origin, auth, header, username, value, now(), old.id);
  else db.prepare('INSERT INTO vault(id,user_id,name,origin,auth,header,username,value,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(newId('vlt'), userId, name, origin, auth, header, username, value, now(), now());
  hub.emit(userId, { type: 'vault' });
  return view(db.prepare('SELECT * FROM vault WHERE user_id=? AND name=?').get(userId, name));
}

export function removeSecret(userId: string, name: string): boolean {
  const r = db.prepare('DELETE FROM vault WHERE user_id=? AND name=?').run(userId, name);
  if (r.changes) hub.emit(userId, { type: 'vault' });
  return r.changes > 0;
}

const row = (userId: string, name: string) => db.prepare('SELECT * FROM vault WHERE user_id=? AND lower(name)=lower(?)').get(userId, name.trim()) as any;
/** Plain value. Only for code that injects it (never returned to the model). */
export function secretValue(userId: string, name: string): { item: VaultItem; value: string } | null {
  const r = row(userId, name);
  return r ? { item: view(r), value: open(r.value) } : null;
}
export const secretNames = (userId: string) => listVault(userId).map((i) => `${i.name} (${i.auth === 'login' ? 'website login' : 'api key'}, site ${i.origin})`);

/** Remove every vault value (and its base64 / URL-encoded form) from text the model will read. */
export function scrubVault(userId: string, text: string): string {
  let out = text;
  try { out = out.split(vaultKey().toString('hex')).join('[vault key hidden]'); } catch { /* no key yet */ }
  for (const r of db.prepare('SELECT value FROM vault WHERE user_id=?').all(userId) as any[]) {
    let v = ''; try { v = open(r.value); } catch { continue; }
    if (v.length < 4) continue;
    const user = String((db.prepare('SELECT username FROM vault WHERE user_id=? AND value=?').get(userId, r.value) as any)?.username ?? '');
    for (const f of new Set([v, Buffer.from(v).toString('base64'), Buffer.from(`${user}:${v}`).toString('base64'), encodeURIComponent(v)])) out = out.split(f).join('[vault secret hidden]');
  }
  return out;
}

/** HTTPS request with the secret injected for its saved origin only. Redirects are not followed, so the key cannot leave. */
export async function secretRequest(userId: string, a: { name: string; url: string; method?: string; body?: string; json?: unknown }): Promise<string> {
  const s = secretValue(userId, a.name);
  if (!s) return JSON.stringify({ error: `No vault item "${a.name}". Names: ${secretNames(userId).join('; ') || 'none, ask the user to add one in Settings → Vault'}` });
  const { item, value } = s;
  if (item.auth === 'login') return JSON.stringify({ error: `"${item.name}" is a website login. Use browser_fill_secret.` });
  const method = (a.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return JSON.stringify({ error: 'Vault requests are read-only (GET/HEAD) for now. Ask the user to do writes, or use the browser.' });
  let url: URL; try { url = new URL(a.url); } catch { return JSON.stringify({ error: 'Not a valid URL.' }); }
  if (url.origin !== item.origin) return JSON.stringify({ error: `"${item.name}" may only be used at ${item.origin}.` });
  const headers: Record<string, string> = { 'user-agent': 'OpenKrishBot' };
  if (item.auth === 'bearer') headers.authorization = `Bearer ${value}`;
  else if (item.auth === 'header') headers[item.header] = value;
  else headers.authorization = `Basic ${Buffer.from(`${item.username}:${value}`).toString('base64')}`;
  let body: string | undefined = a.body;
  if (a.json !== undefined) { body = JSON.stringify(a.json); headers['content-type'] = 'application/json'; }
  try {
    const res = await fetch(url, { method, headers, body: undefined, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const text = scrubVault(userId, (await res.text()).slice(0, 12000));
    return JSON.stringify({ status: res.status, body: text });
  } catch (e: any) { return JSON.stringify({ error: scrubVault(userId, String(e?.message ?? e)) }); }
}
