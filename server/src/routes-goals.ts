import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { createGoal, deleteGoal, linkIssue, listGoals, updateGoal } from './goals.js';

/** /api/goals: the goals tree. */
export const goalsApi = new Hono<AuthVars>();
goalsApi.use('*', requireUser);

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

goalsApi.get('/', (c) => c.json({ goals: listGoals(c.get('user').id) }));

goalsApi.post('/', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const g = createGoal(c.get('user').id, { title: text(b.title, 200) ?? '', description: text(b.description, 4000), level: b.level, parentId: b.parentId || null, ownerBotId: b.ownerBotId || null });
  return 'error' in g ? c.json({ error: g.error }, 400) : c.json({ goal: g });
});

goalsApi.patch('/:id', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const g = updateGoal(c.get('user').id, c.req.param('id'), {
    title: text(b.title, 200), description: text(b.description, 4000), level: b.level, status: b.status,
    parentId: b.parentId === undefined ? undefined : b.parentId || null, ownerBotId: b.ownerBotId === undefined ? undefined : b.ownerBotId || null,
  });
  if (!g) return c.json({ error: 'not found' }, 404);
  return 'error' in g ? c.json({ error: g.error }, 400) : c.json({ goal: g });
});

goalsApi.delete('/:id', (c) => (deleteGoal(c.get('user').id, c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

/** Point an issue at a goal: PUT /api/goals/link { issueId, goalId|null } */
goalsApi.put('/link', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const err = linkIssue(c.get('user').id, String(b.issueId ?? ''), b.goalId || null);
  return err ? c.json({ error: err }, err === 'No such issue.' ? 404 : 400) : c.json({ ok: true });
});
