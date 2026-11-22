import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';
import { redact } from './danger.js';
import { scrubVault } from './vault.js';
import { emitBot } from './store.js';

/**
 * Projects (from OpenMan): shared instructions + small reference files that every bot in the project
 * reads on each turn. Stored locally. A bot belongs to at most one project (bots.project_id).
 */
db.exec(`CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
)`);
const cols = db.prepare('PRAGMA table_info(bots)').all() as { name: string }[];
if (!cols.some((c) => c.name === 'project_id')) db.exec('ALTER TABLE bots ADD COLUMN project_id TEXT');

export const MAX_FILES = 20;
export const MAX_FILE_CHARS = 100_000;
export const MAX_INSTRUCTIONS = 20_000;
const touch = (userId: string) => hub.emit(userId, { type: 'projects' });

export interface Project { id: string; name: string; instructions: string; files: { id: string; name: string; size: number }[]; botIds: string[]; updatedAt: number }

function view(r: any): Project {
  return {
    id: r.id, name: r.name, instructions: r.instructions, updatedAt: r.updated_at,
    files: (db.prepare('SELECT id,name,length(content) AS size FROM project_files WHERE project_id=? ORDER BY created_at').all(r.id) as any[]),
    botIds: (db.prepare('SELECT id FROM bots WHERE project_id=?').all(r.id) as any[]).map((b) => b.id),
  };
}
const own = (userId: string, id: string) => db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(id, userId) as any;

export const listProjects = (userId: string) => (db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY created_at').all(userId) as any[]).map(view);

export function createProject(userId: string, a: { name?: string; instructions?: string }): Project | { error: string } {
  const name = String(a.name ?? '').trim().slice(0, 200);
  if (!name) return { error: 'A project needs a name.' };
  if ((a.instructions ?? '').length > MAX_INSTRUCTIONS) return { error: `Instructions: at most ${MAX_INSTRUCTIONS} characters.` };
  const id = newId('prj');
  db.prepare('INSERT INTO projects(id,user_id,name,instructions,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, userId, name, a.instructions ?? '', now(), now());
  touch(userId);
  return view(own(userId, id));
}

export function updateProject(userId: string, id: string, a: { name?: string; instructions?: string }): Project | { error: string } | null {
  const p = own(userId, id);
  if (!p) return null;
  const name = a.name === undefined ? p.name : String(a.name).trim().slice(0, 200);
  if (!name) return { error: 'A project needs a name.' };
  const instructions = a.instructions === undefined ? p.instructions : String(a.instructions);
  if (instructions.length > MAX_INSTRUCTIONS) return { error: `Instructions: at most ${MAX_INSTRUCTIONS} characters.` };
  db.prepare('UPDATE projects SET name=?, instructions=?, updated_at=? WHERE id=?').run(name, instructions, now(), id);
  touch(userId);
  return view(own(userId, id));
}

export function deleteProject(userId: string, id: string): boolean {
  if (!own(userId, id)) return false;
  db.prepare('UPDATE bots SET project_id=NULL WHERE project_id=?').run(id);
  db.prepare('DELETE FROM projects WHERE id=?').run(id);
  touch(userId);
  return true;
}

export function addFile(userId: string, id: string, f: { name?: string; content?: string }): Project | { error: string } | null {
  if (!own(userId, id)) return null;
  const name = String(f.name ?? '').trim().slice(0, 200);
  if (!name || typeof f.content !== 'string') return { error: 'A file needs a name and text content.' };
  if (f.content.length > MAX_FILE_CHARS) return { error: `"${name}" is longer than ${MAX_FILE_CHARS} characters.` };
  const n = (db.prepare('SELECT COUNT(*) AS n FROM project_files WHERE project_id=?').get(id) as any).n;
  const same = db.prepare('SELECT id FROM project_files WHERE project_id=? AND lower(name)=lower(?)').get(id, name) as any;
  if (!same && n >= MAX_FILES) return { error: `At most ${MAX_FILES} files per project.` };
  if (same) db.prepare('UPDATE project_files SET content=? WHERE id=?').run(f.content, same.id);
  else db.prepare('INSERT INTO project_files(id,project_id,name,content,created_at) VALUES (?,?,?,?,?)').run(newId('pf'), id, name, f.content, now());
  db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now(), id);
  touch(userId);
  return view(own(userId, id));
}

export function removeFile(userId: string, id: string, fileId: string): boolean {
  if (!own(userId, id)) return false;
  const r = db.prepare('DELETE FROM project_files WHERE id=? AND project_id=?').run(fileId, id);
  touch(userId);
  return r.changes > 0;
}

export function readFile(userId: string, id: string, fileId: string): { name: string; content: string } | null {
  if (!own(userId, id)) return null;
  return (db.prepare('SELECT name,content FROM project_files WHERE id=? AND project_id=?').get(fileId, id) as any) ?? null;
}

/** Put a bot in a project (null = out). Returns an error text or null. */
export function assignBot(userId: string, botId: string, projectId: string | null): string | null {
  const b = db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as any;
  if (!b || b.user_id !== userId) return 'No such bot.';
  if (projectId && !own(userId, projectId)) return 'No such project.';
  db.prepare('UPDATE bots SET project_id=? WHERE id=?').run(projectId, botId);
  emitBot(botId);
  touch(userId);
  return null;
}

/** What goes into the bot's system prompt. Empty when the bot has no project. Files are listed by name; small ones are inlined. */
export function projectPrompt(botId: string): string {
  const b = db.prepare('SELECT project_id FROM bots WHERE id=?').get(botId) as any;
  const p = b?.project_id ? (db.prepare('SELECT * FROM projects WHERE id=?').get(b.project_id) as any) : null;
  if (!p) return '';
  const files = db.prepare('SELECT name,content FROM project_files WHERE project_id=? ORDER BY created_at').all(p.id) as any[];
  let budget = 24_000;
  const parts = files.map((f) => {
    if (f.content.length <= 6000 && f.content.length <= budget) { budget -= f.content.length; return `### ${f.name}\n${f.content}`; }
    return `### ${f.name}\n(${f.content.length} characters: too long to include here, use read_project_file to open it)`;
  });
  return `\n## Project: ${p.name}\nYou work inside this project, shared with its other bots. Follow its instructions.${p.instructions.trim() ? `\n\n${p.instructions.trim()}` : ''}${parts.length ? `\n\n### Reference files\n${parts.join('\n\n')}` : ''}\n`;
}

export function readProjectFileByName(botId: string, name: string): { name: string; content: string } | null {
  const b = db.prepare('SELECT project_id FROM bots WHERE id=?').get(botId) as any;
  if (!b?.project_id) return null;
  return (db.prepare('SELECT name,content FROM project_files WHERE project_id=? AND lower(name)=lower(?)').get(b.project_id, name.trim()) as any) ?? null;
}

/** Company = project. Find one by name (any case) or create it. */
export function companyByName(userId: string, name: string, goal?: string): string {
  const found = db.prepare('SELECT id FROM projects WHERE user_id=? AND lower(name)=lower(?)').get(userId, name.trim()) as any;
  if (found) return found.id;
  const r = createProject(userId, { name, instructions: goal ?? '' });
  if ('error' in r) throw new Error(r.error);
  return r.id;
}

export interface CompanyExport { format: 'openkrishbot-company-v1'; name: string; instructions: string; files: { name: string; content: string }[]; bots: { name: string; role: string; instructions: string; avatarShape: string; avatarColor: string }[] }

/** A company as one JSON file: bots and their jobs, shared instructions, reference files. Never chats, memory, keys or vault. */
export function exportCompany(userId: string, id: string): CompanyExport | null {
  const p = own(userId, id);
  if (!p) return null;
  const bots = db.prepare("SELECT name,description,label,instructions,avatar_shape,avatar_color FROM bots WHERE project_id=? AND COALESCE(kind,'agent')<>'room' ORDER BY created_at").all(id) as any[];
  const files = db.prepare('SELECT name,content FROM project_files WHERE project_id=? ORDER BY created_at').all(id) as any[];
  const clean = (t: string) => redact(scrubVault(userId, String(t ?? '')));
  return { format: 'openkrishbot-company-v1', name: p.name, instructions: clean(p.instructions), files: files.map((f) => ({ name: f.name, content: clean(f.content) })), bots: bots.map((b) => ({ name: b.name, role: b.description || b.label, instructions: clean(b.instructions), avatarShape: b.avatar_shape, avatarColor: b.avatar_color })) };
}

/** crewAI-style role: optional goal and backstory are put in front of the instructions. */
const roleInstructions = (b: any) => [b.goal && `Your goal: ${b.goal}`, b.backstory && `Background: ${b.backstory}`, b.instructions].filter(Boolean).map(String).join('\n\n');

export function importCompany(userId: string, data: any, hire: (b: { name: string; label: string; description: string; instructions: string; avatarShape: string; avatarColor: string }) => string): Project | { error: string } {
  if (data?.format !== 'openkrishbot-company-v1' || !Array.isArray(data.bots)) return { error: 'Not an OpenKrishBot company file.' };
  if (data.bots.length > 20) return { error: 'A company file can hold at most 20 bots.' };
  if (data.bots.some((b: any) => !b || typeof b !== 'object')) return { error: 'The file has a broken bot entry.' };
  let name = String(data.name || 'Company').slice(0, 190);
  while (db.prepare('SELECT 1 FROM projects WHERE user_id=? AND lower(name)=lower(?)').get(userId, name)) name += ' (imported)';
  const proj = createProject(userId, { name, instructions: String(data.instructions ?? '').slice(0, MAX_INSTRUCTIONS) });
  if ('error' in proj) return proj;
  for (const f of (data.files ?? []).slice(0, MAX_FILES)) addFile(userId, proj.id, { name: String(f.name), content: String(f.content ?? '').slice(0, MAX_FILE_CHARS) });
  const taken = (n: string) => db.prepare('SELECT 1 FROM bots WHERE user_id=? AND lower(name)=lower(?)').get(userId, n);
  for (const b of data.bots.slice(0, 20)) {
    let n = String(b.name || 'Bot').slice(0, 60);
    while (taken(n)) n += ' 2';
    const id = hire({ name: n, label: `${name} · ${b.role ?? ''}`, description: String(b.role ?? ''), instructions: roleInstructions(b), avatarShape: b.avatarShape, avatarColor: b.avatarColor });
    assignBot(userId, id, proj.id);
  }
  return view(own(userId, proj.id));
}
