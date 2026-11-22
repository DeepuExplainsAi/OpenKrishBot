import { Hono } from 'hono';
import { db } from './db.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { addComment, createIssue, listComments, listIssues, setStatus, type IssueStatus } from './issues.js';

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
  if (!i) return c.json({ error: 'not found' }, 404);
  return 'error' in i ? c.json({ error: i.error }, 409) : c.json({ issue: i });
});

issuesApi.delete('/:id', (c) => {
  const r = db.prepare('DELETE FROM issues WHERE id=? AND user_id=?').run(c.req.param('id'), c.get('user').id);
  return r.changes ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
});

const ownIssue = (userId: string, id: string) => db.prepare('SELECT 1 FROM issues WHERE id=? AND user_id=?').get(id, userId);

issuesApi.get('/:id/comments', (c) => ownIssue(c.get('user').id, c.req.param('id')) ? c.json({ comments: listComments(c.get('user').id, c.req.param('id')) }) : c.json({ error: 'not found' }, 404));

issuesApi.post('/:id/comments', async (c) => {
  if (!ownIssue(c.get('user').id, c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json<{ text?: string }>().catch(() => ({} as any));
  const r = addComment(c.get('user').id, c.req.param('id'), null, String(b.text ?? ''));
  return r.ok ? c.json({ comment: r.comment }) : c.json({ error: r.reason }, 400);
});
