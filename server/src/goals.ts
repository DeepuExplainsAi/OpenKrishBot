import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';

/**
 * Paperclip's goals, on SQLite for one user: a tree (mission > project > task-sized goals), each with an owner Bot.
 * Issues point at a goal; a goal's progress is how many of its issues, and its sub-goals' issues, are done.
 */
export type GoalLevel = 'mission' | 'project' | 'task';
export type GoalStatus = 'planned' | 'active' | 'achieved' | 'cancelled';
export const LEVELS: GoalLevel[] = ['mission', 'project', 'task'];
export const GOAL_STATUSES: GoalStatus[] = ['planned', 'active', 'achieved', 'cancelled'];
export interface Goal { id: string; title: string; description: string; level: GoalLevel; status: GoalStatus; parentId: string | null; ownerBotId: string | null; updatedAt: number; done: number; total: number }

db.exec(`CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'project', status TEXT NOT NULL DEFAULT 'planned', parent_id TEXT, owner_bot TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`);

const touch = (userId: string) => hub.emit(userId, { type: 'goals' });
const own = (userId: string, id: string) => db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(id, userId) as any;

/** The goal and every goal below it. */
function subtree(userId: string, id: string): string[] {
  const all = db.prepare('SELECT id, parent_id FROM goals WHERE user_id=?').all(userId) as { id: string; parent_id: string | null }[];
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const g of all) if (g.parent_id === out[i] && !out.includes(g.id)) out.push(g.id);
  return out;
}

export function listGoals(userId: string): Goal[] {
  const rows = db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at, rowid').all(userId) as any[];
  const counts = new Map<string, { done: number; total: number }>();
  for (const r of db.prepare("SELECT goal_id g, status s, COUNT(*) n FROM issues WHERE user_id=? AND goal_id IS NOT NULL AND status!='cancelled' GROUP BY goal_id, status").all(userId) as any[]) {
    const c = counts.get(r.g) ?? { done: 0, total: 0 };
    c.total += r.n; if (r.s === 'done') c.done += r.n;
    counts.set(r.g, c);
  }
  const kids = new Map<string | null, any[]>();
  for (const r of rows) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  const roll = (id: string): { done: number; total: number } => {
    const own = counts.get(id) ?? { done: 0, total: 0 };
    return (kids.get(id) ?? []).reduce((a, k) => { const c = roll(k.id); return { done: a.done + c.done, total: a.total + c.total }; }, { ...own });
  };
  return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, level: r.level, status: r.status, parentId: r.parent_id, ownerBotId: r.owner_bot, updatedAt: r.updated_at, ...roll(r.id) }));
}

function check(userId: string, p: { level?: string; status?: string; parentId?: string | null; ownerBotId?: string | null }, selfId?: string): string | null {
  if (p.level !== undefined && !LEVELS.includes(p.level as GoalLevel)) return 'Unknown level.';
  if (p.status !== undefined && !GOAL_STATUSES.includes(p.status as GoalStatus)) return 'Unknown status.';
  if (p.parentId) {
    if (!own(userId, p.parentId)) return 'No such parent goal.';
    if (selfId && subtree(userId, selfId).includes(p.parentId)) return 'A goal cannot sit under itself.';
  }
  if (p.ownerBotId && !db.prepare("SELECT 1 FROM bots WHERE id=? AND user_id=? AND kind!='room'").get(p.ownerBotId, userId)) return 'Unknown bot.';
  return null;
}

export function createGoal(userId: string, o: { title: string; description?: string; level?: GoalLevel; parentId?: string | null; ownerBotId?: string | null }): Goal | { error: string } {
  const title = String(o.title ?? '').trim().slice(0, 200);
  if (!title) return { error: 'A goal needs a title.' };
  const bad = check(userId, o);
  if (bad) return { error: bad };
  const id = newId('goal');
  db.prepare('INSERT INTO goals(id,user_id,title,description,level,status,parent_id,owner_bot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, userId, title, String(o.description ?? '').slice(0, 4000), o.level ?? (o.parentId ? 'task' : 'mission'), 'active', o.parentId ?? null, o.ownerBotId ?? null, now(), now());
  touch(userId);
  return listGoals(userId).find((g) => g.id === id)!;
}

export function updateGoal(userId: string, id: string, p: { title?: string; description?: string; level?: GoalLevel; status?: GoalStatus; parentId?: string | null; ownerBotId?: string | null }): Goal | { error: string } | null {
  const cur = own(userId, id);
  if (!cur) return null;
  const bad = check(userId, p, id);
  if (bad) return { error: bad };
  const title = p.title === undefined ? cur.title : String(p.title).trim().slice(0, 200);
  if (!title) return { error: 'A goal needs a title.' };
  db.prepare('UPDATE goals SET title=?, description=?, level=?, status=?, parent_id=?, owner_bot=?, updated_at=? WHERE id=?').run(
    title, p.description === undefined ? cur.description : String(p.description).slice(0, 4000), p.level ?? cur.level, p.status ?? cur.status,
    p.parentId === undefined ? cur.parent_id : p.parentId, p.ownerBotId === undefined ? cur.owner_bot : p.ownerBotId, now(), id);
  touch(userId);
  return listGoals(userId).find((g) => g.id === id)!;
}

/** Deleting a goal lifts its sub-goals and issues to the goal's parent instead of losing them. */
export function deleteGoal(userId: string, id: string): boolean {
  const cur = own(userId, id);
  if (!cur) return false;
  db.prepare('UPDATE goals SET parent_id=? WHERE parent_id=? AND user_id=?').run(cur.parent_id, id, userId);
  db.prepare('UPDATE issues SET goal_id=? WHERE goal_id=? AND user_id=?').run(cur.parent_id, id, userId);
  db.prepare('DELETE FROM goals WHERE id=?').run(id);
  touch(userId);
  return true;
}

/** Point an issue at a goal (or clear it). */
export function linkIssue(userId: string, issueId: string, goalId: string | null): string | null {
  if (goalId && !own(userId, goalId)) return 'No such goal.';
  const r = db.prepare('UPDATE issues SET goal_id=? WHERE id=? AND user_id=?').run(goalId, issueId, userId);
  if (!r.changes) return 'No such issue.';
  touch(userId); hub.emit(userId, { type: 'issues' });
  return null;
}

/** For a Bot's prompt: the active goals it owns, so its work stays tied to the bigger picture. */
export function goalsFor(botId: string): { id: string; title: string; description: string }[] {
  return db.prepare("SELECT id, title, description FROM goals WHERE owner_bot=? AND status='active' ORDER BY created_at LIMIT 5").all(botId) as any[];
}
