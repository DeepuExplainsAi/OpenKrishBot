import fs from 'node:fs';
import path from 'node:path';

/**
 * Notes in MEMORY.md / USER.md, separated by "§". Saving never piles up duplicates (the mem0 idea of
 * add / update / delete, done with plain word overlap so it costs no model call):
 * a note close to an existing one replaces it, `replaces` swaps a named old note, `forget` removes one.
 */
const SEP = '\n§\n';
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export function similarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let same = 0;
  for (const w of x) if (y.has(w)) same++;
  return same / Math.min(x.size, y.size) * (same / Math.max(x.size, y.size)) ** 0.5;
}

const SAME_AT = 0.8;

export function saveNote(file: string, note: string, opts: { replaces?: string; forget?: boolean } = {}): string {
  const text = note.trim();
  if (!text) return 'Nothing to save.';
  const entries = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\n§\n/).map((e) => e.trim()).filter(Boolean) : [];
  const find = (q: string) => {
    const needle = q.toLowerCase();
    const sub = entries.findIndex((e) => e.toLowerCase().includes(needle));
    if (sub >= 0) return sub;
    let best = -1, top = 0;
    entries.forEach((e, i) => { const s = similarity(e, q); if (s > top) { top = s; best = i; } });
    return top >= SAME_AT ? best : -1;
  };
  let result: string;
  if (opts.forget) {
    const i = find(text);
    if (i < 0) return 'No matching note.';
    entries.splice(i, 1);
    result = 'Forgotten.';
  } else {
    const i = find(opts.replaces || text);
    if (i >= 0) { result = entries[i].toLowerCase() === text.toLowerCase() ? 'Already saved.' : 'Updated.'; if (result === 'Updated.') entries[i] = text; }
    else { entries.push(text); result = 'Saved.'; }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.length ? entries.join(SEP) + '\n' : '');
  return result;
}
