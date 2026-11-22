import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';

/**
 * Paperclip-style issues for a team of local bots: assignee, parent/child delegation, and an atomic
 * checkout so two bots (or a bot and a heartbeat) never work the same issue. Single user, no companies.
 */
export type IssueStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export interface Issue { id: string; title: string; body: string; status: IssueStatus; assigneeBotId: string | null; createdByBotId: string | null; parentId: string | null; checkoutBotId: string | null; result: string; updatedAt: number }

db.exec(`CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo', assignee_bot TEXT, created_by_bot TEXT, parent_id TEXT,
  checkout_bot TEXT, result TEXT NOT NULL DEFAULT '', last_wake INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, author TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
)`);
export interface IssueComment { id: string; issueId: string; author: string; text: string; createdAt: number }
const toComment = (r: any): IssueComment => ({ id: r.id, issueId: r.issue_id, author: r.author, text: r.text, createdAt: r.created_at });
const ownsIssue = (userId: string, issueId: string) => !!db.prepare('SELECT 1 FROM issues WHERE id=? AND user_id=?').get(issueId, userId);
export const listComments = (userId: string, issueId: string): IssueComment[] =>
  ownsIssue(userId, issueId) ? (db.prepare('SELECT * FROM issue_comments WHERE issue_id=? ORDER BY created_at, rowid').all(issueId) as any[]).map(toComment) : [];
/** Bots answering each other's comments can't loop: after this many bot notes in a row (no user note between), nobody is woken. */
const MAX_BOT_COMMENT_RUN = 6;

/** A note on an issue, from the user (authorBotId null) or a bot. The assignee and the creator (whoever is not the author) are woken. */
export function addComment(userId: string, issueId: string, authorBotId: string | null, text: string): { ok: true; comment: IssueComment } | { ok: false; reason: string } {
  const i = ownsIssue(userId, issueId) ? getIssue(issueId) : null;
  if (!i) return { ok: false, reason: `No issue ${issueId}.` };
  const body = text.trim().slice(0, 4000);
  if (!body) return { ok: false, reason: 'Write something.' };
  const id = newId('cmt');
  db.prepare('INSERT INTO issue_comments(id,issue_id,author,text,created_at) VALUES (?,?,?,?,?)').run(id, issueId, authorBotId ?? 'user', body, now());
  touch(userId);
  const botRun = authorBotId ? (db.prepare("SELECT COUNT(*) n FROM issue_comments WHERE issue_id=? AND author!='user' AND rowid>COALESCE((SELECT MAX(rowid) FROM issue_comments WHERE issue_id=? AND author='user'),0)").get(issueId, issueId) as any).n : 0;
  const quiet = botRun > MAX_BOT_COMMENT_RUN;
  const who = authorBotId ? botName(authorBotId) : 'The user';
  for (const target of new Set([i.checkoutBotId ?? i.assigneeBotId, i.createdByBotId])) {
    if (!quiet && target && target !== authorBotId && !['done', 'cancelled'].includes(i.status)) wake(target, `${who} commented on issue ${issueId} "${i.title}": ${body}`);
  }
  return { ok: true, comment: toComment(db.prepare('SELECT * FROM issue_comments WHERE id=?').get(id)) };
}

const to = (r: any): Issue => ({ id: r.id, title: r.title, body: r.body, status: r.status, assigneeBotId: r.assignee_bot, createdByBotId: r.created_by_bot, parentId: r.parent_id, checkoutBotId: r.checkout_bot, result: r.result, updatedAt: r.updated_at });
const touch = (userId: string) => hub.emit(userId, { type: 'issues' });
const botName = (id: string | null) => (id ? (db.prepare('SELECT name FROM bots WHERE id=?').get(id) as any)?.name ?? id : 'nobody');

let wake: (botId: string, text: string) => void = () => {};
export const initIssues = (fn: typeof wake) => { wake = fn; };

const wakeText = (i: Issue) => `Issue ${i.id} is assigned to you: "${i.title}".${i.body ? `\n${i.body}` : ''}\nCall checkout_issue first, do the work, then complete_issue with the result (or block_issue if you are stuck).`;

export function createIssue(o: { userId: string; title: string; body?: string; assigneeBotId?: string | null; parentId?: string | null; createdByBotId?: string | null }): Issue {
  const title = o.title.trim();
  if (!title) throw new Error('An issue needs a title.');
  if (o.parentId && !(db.prepare('SELECT 1 FROM issues WHERE id=? AND user_id=?').get(o.parentId, o.userId))) throw new Error(`No issue ${o.parentId}.`);
  // bots handing work to bots can't snowball: at most 40 open issues at once
  if (o.createdByBotId && (db.prepare("SELECT COUNT(*) n FROM issues WHERE user_id=? AND status IN ('todo','in_progress','blocked')").get(o.userId) as any).n >= 40) throw new Error('There are already 40 open issues. Finish some first.');
  const id = newId('iss');
  db.prepare('INSERT INTO issues(id,user_id,title,body,assignee_bot,created_by_bot,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, o.userId, title, o.body ?? '', o.assigneeBotId ?? null, o.createdByBotId ?? null, o.parentId ?? null, now(), now());
  const issue = to(db.prepare('SELECT * FROM issues WHERE id=?').get(id));
  touch(o.userId);
  if (issue.assigneeBotId) wakeAssignee(issue);
  return issue;
}

function wakeAssignee(i: Issue) {
  if (!i.assigneeBotId) return;
  db.prepare('UPDATE issues SET last_wake=? WHERE id=?').run(now(), i.id);
  wake(i.assigneeBotId, wakeText(i));
}

export const getIssue = (id: string): Issue | null => { const r = db.prepare('SELECT * FROM issues WHERE id=?').get(id); return r ? to(r) : null; };
const openChildren = (id: string) => (db.prepare("SELECT COUNT(*) n FROM issues WHERE parent_id=? AND status NOT IN ('done','cancelled')").get(id) as any).n as number;

/** Atomic: one UPDATE decides the owner. Unassigned issues are claimed by the caller; assigned ones only by their assignee. */
export function checkout(id: string, botId: string): { ok: true; issue: Issue } | { ok: false; reason: string } {
  const r = db.prepare("UPDATE issues SET status='in_progress', checkout_bot=?, assignee_bot=COALESCE(assignee_bot, ?), updated_at=? WHERE id=? AND status='todo' AND checkout_bot IS NULL AND (assignee_bot IS NULL OR assignee_bot=?)")
    .run(botId, botId, now(), id, botId);
  const issue = getIssue(id);
  if (!issue) return { ok: false, reason: `No issue ${id}.` };
  if (r.changes === 0) {
    if (issue.checkoutBotId) return { ok: false, reason: `${botName(issue.checkoutBotId)} already has it checked out.` };
    if (issue.assigneeBotId && issue.assigneeBotId !== botId) return { ok: false, reason: `It is assigned to ${botName(issue.assigneeBotId)}.` };
    return { ok: false, reason: `It is ${issue.status}, not todo.` };
  }
  return { ok: true, issue };
}

/** Only the bot holding the checkout can finish, block or release it. A parent waits for its children. */
export function finish(id: string, botId: string, status: 'done' | 'blocked' | 'todo', result = ''): { ok: true; issue: Issue } | { ok: false; reason: string } {
  const cur = getIssue(id);
  if (!cur) return { ok: false, reason: `No issue ${id}.` };
  if (cur.checkoutBotId !== botId) return { ok: false, reason: cur.checkoutBotId ? `${botName(cur.checkoutBotId)} holds it.` : 'Check it out first.' };
  if (status === 'done' && openChildren(id)) return { ok: false, reason: `It has ${openChildren(id)} unfinished sub-issue(s). Wait for them.` };
  db.prepare('UPDATE issues SET status=?, result=?, checkout_bot=?, updated_at=? WHERE id=?').run(status, result, status === 'todo' ? null : botId, now(), id);
  const issue = getIssue(id)!;
  const owner = (db.prepare('SELECT user_id FROM issues WHERE id=?').get(id) as any).user_id;
  touch(owner);
  if (status === 'done' || status === 'blocked') {
    const back = issue.createdByBotId && issue.createdByBotId !== botId ? issue.createdByBotId : null;
    const p = status === 'done' && issue.parentId && !openChildren(issue.parentId) ? getIssue(issue.parentId) : null;
    const parentBot = p ? p.checkoutBotId ?? p.assigneeBotId : null;
    const allDone = p ? `All sub-issues of ${p.id} "${p.title}" are done. You can complete it now.` : '';
    if (back) wake(back, `Issue ${id} "${issue.title}" is ${status} (${botName(botId)}): ${result || 'no details'}${parentBot === back ? `\n${allDone}` : ''}`);
    if (parentBot && parentBot !== back) wake(parentBot, allDone);
  }
  return { ok: true, issue };
}

export function setStatus(userId: string, id: string, patch: { status?: IssueStatus; assigneeBotId?: string | null }): Issue | null {
  const cur = db.prepare('SELECT * FROM issues WHERE id=? AND user_id=?').get(id, userId) as any;
  if (!cur) return null;
  const status = patch.status ?? cur.status;
  const assignee = patch.assigneeBotId === undefined ? cur.assignee_bot : patch.assigneeBotId;
  const reassigned = assignee !== cur.assignee_bot;
  // moving an issue releases any checkout, so a new owner can take it
  const release = reassigned || status === 'todo' || status === 'cancelled' || status === 'done';
  db.prepare('UPDATE issues SET status=?, assignee_bot=?, checkout_bot=?, updated_at=? WHERE id=?').run(reassigned && status === 'in_progress' ? 'todo' : status, assignee, release ? null : cur.checkout_bot, now(), id);
  const issue = getIssue(id)!;
  touch(userId);
  if (issue.status === 'todo' && issue.assigneeBotId && (reassigned || cur.status !== 'todo')) wakeAssignee(issue);
  return issue;
}

export const listIssues = (userId: string): Issue[] => (db.prepare("SELECT * FROM issues WHERE user_id=? ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END, updated_at DESC LIMIT 300").all(userId) as any[]).map(to);
export const issuesFor = (botId: string): Issue[] => (db.prepare("SELECT * FROM issues WHERE assignee_bot=? AND status IN ('todo','in_progress','blocked') ORDER BY updated_at DESC LIMIT 20").all(botId) as any[]).map(to);

const HEARTBEAT_MS = 10 * 60_000;
/** Paperclip heartbeat: an idle bot with a todo issue it never picked up gets nudged, at most once per interval per issue. */
export function heartbeat(isBusy: (botId: string) => boolean, nowMs = now()): number {
  const due = db.prepare("SELECT * FROM issues WHERE status='todo' AND assignee_bot IS NOT NULL AND checkout_bot IS NULL AND last_wake<?").all(nowMs - HEARTBEAT_MS) as any[];
  let n = 0;
  for (const r of due) { if (isBusy(r.assignee_bot)) continue; wakeAssignee(to(r)); n++; }
  return n;
}
export const startHeartbeat = (isBusy: (botId: string) => boolean) => setInterval(() => { try { heartbeat(isBusy); } catch (e) { console.error('[heartbeat]', e); } }, 60_000).unref();
