import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { db } from './db.js';
import { isSecretFile } from './local-files-rules.js';

/** nod's "keep-out" list (local-files + keep-out.ts) on SQLite: folders and files Bots must never read, write or list. */
const KEY = 'local_keep_out';
export const KEEP_OUT_LIMIT = 100;

const norm = (p: string) => { const r = path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir())); return process.platform === 'win32' ? r.toLowerCase() : r; };
/** Real path with symlinks resolved; for a path that does not exist yet, the nearest existing parent is resolved and the rest appended. */
const real = (p: string): string => {
  const abs = path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
  let head = abs; const tail: string[] = [];
  for (;;) {
    try { return norm(path.join(fs.realpathSync(head), ...tail.reverse())); } catch { /* not there yet */ }
    const up = path.dirname(head);
    if (up === head) return norm(abs);
    tail.push(path.basename(head)); head = up;
  }
};
const within = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

export function keepOutList(): string[] {
  try { const v = (db.prepare('SELECT value FROM kv WHERE key=?').get(KEY) as { value: string } | undefined)?.value; const l = v ? JSON.parse(v) : []; return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
const save = (l: string[]) => db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(KEY, JSON.stringify(l));

export function addKeepOut(entry: string): { list: string[] } | { error: string } {
  const e = entry.trim();
  if (!e) return { error: 'Enter a folder or file path' };
  const l = keepOutList();
  if (l.includes(e)) return { list: l };
  if (l.length >= KEEP_OUT_LIMIT) return { error: `The keep-out list already has ${KEEP_OUT_LIMIT} entries. Remove some first.` };
  l.push(e); save(l); return { list: l };
}
export function removeKeepOut(entry: string): string[] { const l = keepOutList().filter((x) => x !== entry); save(l); return l; }

/** True when `target` is one of the kept-out paths or inside one (symlinks resolved). */
export function isKeptOut(target: string): boolean {
  const t = [norm(target), real(target)];
  if (t.some((x, i) => isSecretFile(i ? x : target))) return true; // the name of the link and of what it points to
  const list = keepOutList();
  if (!list.length) return false;
  return list.some((e) => [norm(e), real(e)].some((kp) => t.some((tp) => within(tp, kp))));
}
export const keepOutError = (target: string) => JSON.stringify({ error: `${target} is on the owner's keep-out list. Do not read, write or list it.` });
