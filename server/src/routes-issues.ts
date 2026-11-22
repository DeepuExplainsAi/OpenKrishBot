import { Hono } from 'hono';
import { db } from './db.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { createIssue, listIssues, setStatus, type IssueStatus } from './issues.js';

/** /api/issues: the user's view of shared work. Users may assign, move and cancel issues; only bots check out and finish them. */
export const issuesApi = new Hono<AuthVars>();
issuesApi.use('*', requireUser);

const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const ownBotId = (userId: string, id: unknown) => (id ? (db.prepare("SELECT id FROM bots WHERE id=? AND user_id=? AND kind!='room'").get(String(id), userId) as any)?.id ?? false : null);

issuesApi.get('/', (c) => c.json({ issues: listIssues(c.get('user').id) }));

issuesApi.post('/', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const userId = c.get('user').id;
  const assignee = ownBotId(userId, b.assigneeBotId);
  if (assignee === false) return c.json({ error: 'Unknown bot.' }, 400);
  try { return c.json({ issue: createIssue({ userId, title: String(b.title ?? ''), body: b.body, assigneeBotId: assignee, parentId: b.parentId }) }); }
  catch (e: any) { return c.json({ error: e.message }, 400); }
});

issuesApi.patch('/:id', async (c) => {
  const b = await c.req.json<{ status?: string; assigneeBotId?: string | null }>().catch(() => ({} as any));
  const userId = c.get('user').id;
  if (b.status !== undefined && !STATUSES.includes(b.status)) return c.json({ error: 'Unknown status.' }, 400);
  const assignee = b.assigneeBotId === undefined ? undefined : ownBotId(userId, b.assigneeBotId);
  if (assignee === false) return c.json({ error: 'Unknown bot.' }, 400);
  const i = setStatus(userId, c.req.param('id'), { status: b.status as IssueStatus | undefined, assigneeBotId: assignee });
  return i ? c.json({ issue: i }) : c.json({ error: 'not found' }, 404);
});

issuesApi.delete('/:id', (c) => {
  const r = db.prepare('DELETE FROM issues WHERE id=? AND user_id=?').run(c.req.param('id'), c.get('user').id);
  return r.changes ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
});
