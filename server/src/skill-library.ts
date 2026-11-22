import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

/**
 * Shipped skills (OpenMausBot's manifest format): server/skills/<id>/{manifest.json, SKILL.md}. A skill is added to a turn's
 * instructions when it is enabled and one of its trigger terms appears in the user's message. Users can switch skills off.
 */
export interface LibrarySkill { id: string; name: string; description: string; triggerTerms: string[]; defaultEnabled: boolean; body: string }

const DIR = process.env.KRISH_SKILLS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const MAX_INJECT = 3;

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

export const skillsPrompt = (message: string, skills = loadLibrary()): string =>
  matchSkills(message, skills).map((s) => `\n## Skill: ${s.name}\n${s.body}\n`).join('');
