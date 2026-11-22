import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

/**
 * Shipped skills (OpenMausBot's manifest format): server/skills/<id>/{manifest.json, SKILL.md}. A skill is added to a turn's
 * instructions when it is enabled and one of its trigger terms appears in the user's message. Users can switch skills off.
 */
export interface LibrarySkill { id: string; name: string; description: string; triggerTerms: string[]; defaultEnabled: boolean; body: string; custom?: boolean }

const DIR = process.env.KRISH_SKILLS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const USER_DIR = process.env.KRISH_USER_SKILLS_DIR ?? path.join(os.homedir(), '.openkrishbot', 'skills');
const MAX_INJECT = 3;

/** Shipped skills plus the ones the user imported (a user skill never replaces a shipped one with the same id). */
export function loadAll(): LibrarySkill[] {
  const shipped = loadLibrary(DIR);
  const ids = new Set(shipped.map((s) => s.id));
  return [...shipped, ...loadLibrary(USER_DIR).filter((s) => !ids.has(s.id)).map((s) => ({ ...s, custom: true }))];
}

export function loadLibrary(dir = DIR): LibrarySkill[] {
  let ids: string[] = [];
  try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
  const out: LibrarySkill[] = [];
  for (const id of ids) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf8'));
      const body = fs.readFileSync(path.join(dir, id, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?\n---\n/, '').trim();
      if (m.id !== id || !m.name || !body) { console.warn(`[skills] skipped ${id}: manifest id/name or SKILL.md missing`); continue; }
      out.push({ id, name: String(m.name), description: String(m.description ?? ''), triggerTerms: (m.triggerTerms ?? []).map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean), defaultEnabled: m.defaultEnabled !== false, body });
    } catch (e: any) { console.warn(`[skills] skipped ${id}: ${e.message}`); }
  }
  return out;
}

const key = (id: string) => `skill:${id}`;
export const isEnabled = (s: LibrarySkill) => { const v = (db.prepare('SELECT value FROM kv WHERE key=?').get(key(s.id)) as any)?.value; return v === undefined ? s.defaultEnabled : v === '1'; };
export const setEnabled = (id: string, on: boolean) => { db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(key(id), on ? '1' : '0'); };

export function matchSkills(message: string, skills: LibrarySkill[], enabled: (s: LibrarySkill) => boolean = isEnabled): LibrarySkill[] {
  const m = message.toLowerCase();
  return skills.filter((s) => enabled(s) && s.triggerTerms.some((t) => t && m.includes(t))).slice(0, MAX_INJECT);
}

export const skillsPrompt = (message: string, skills = loadAll()): string =>
  matchSkills(message, skills).map((s) => `\n## Skill: ${s.name}\n${s.body}\n`).join('');

/** SKILL.md front matter: `name:` and `description:` (optional `triggers: a, b`). Without triggers the skill answers to its own name. */
export function parseSkillMd(md: string): { id: string; name: string; description: string; triggerTerms: string[]; body: string } {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const field = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const body = md.replace(/^---[\s\S]*?\n---\n?/, '').trim();
  const name = field('name') || body.match(/^#\s+(.+)$/m)?.[1].trim() || '';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!id || !body) throw new Error('This SKILL.md has no name or no instructions.');
  const listed = field('triggers').replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
  return { id, name, description: field('description'), triggerTerms: listed.length ? listed : [...new Set([name.toLowerCase(), id.replace(/-/g, ' ')])], body };
}

export function installSkill(md: string, dir = USER_DIR): LibrarySkill {
  if (md.length > 100_000) throw new Error('This skill is too large (100 KB at most).');
  const p = parseSkillMd(md);
  if (loadLibrary(DIR).some((x) => x.id === p.id)) throw new Error(`"${p.name}" is already a built-in skill.`);
  fs.mkdirSync(path.join(dir, p.id), { recursive: true });
  fs.writeFileSync(path.join(dir, p.id, 'SKILL.md'), md);
  fs.writeFileSync(path.join(dir, p.id, 'manifest.json'), JSON.stringify({ id: p.id, name: p.name, description: p.description, triggerTerms: p.triggerTerms, defaultEnabled: true }, null, 2));
  return { id: p.id, name: p.name, description: p.description, triggerTerms: p.triggerTerms, defaultEnabled: true, body: p.body, custom: true };
}

export function removeSkill(id: string, dir = USER_DIR): boolean {
  if (!/^[a-z0-9-]+$/.test(id) || !fs.existsSync(path.join(dir, id))) return false;
  fs.rmSync(path.join(dir, id), { recursive: true, force: true });
  return true;
}

/** github.com/<owner>/<repo>[/tree/<branch>/<folder>] -> where its SKILL.md lives. Only github.com is ever contacted. */
export function parseGithubUrl(url: string): { owner: string; repo: string; ref?: string; dir: string } {
  const m = url.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)\/?(.*?))?\/?$/);
  if (!m) throw new Error('Paste a public GitHub link, like https://github.com/owner/repo or a folder inside it.');
  return { owner: m[1], repo: m[2], ref: m[3], dir: (m[4] ?? '').replace(/\/?SKILL\.md$/i, '') };
}

export async function importFromGithub(url: string, fetchImpl: typeof fetch = fetch, dir = USER_DIR): Promise<LibrarySkill> {
  const g = parseGithubUrl(url);
  const api = `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${[g.dir, 'SKILL.md'].filter(Boolean).join('/')}${g.ref ? `?ref=${encodeURIComponent(g.ref)}` : ''}`;
  const res = await fetchImpl(api, { headers: { accept: 'application/vnd.github.raw+json', 'user-agent': 'openkrishbot' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new Error('No SKILL.md found there. Link the folder that contains it.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  return installSkill(await res.text(), dir);
}
