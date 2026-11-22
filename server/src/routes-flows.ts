import { Hono } from 'hono';
import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { enqueue, runInBotQueue } from './agent/loop.js';
import { appendRow, getBotRow, listRows } from './store.js';
import { runFlow, validate, type FlowStep, type RunResults } from './flow.js';

db.exec(`
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE, input TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, results TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER
);`);

/** Multi-agent workflows: /api/flows. Each step is a message to one of the user's bots; independent steps run in parallel. */
export const flowsApi = new Hono<AuthVars>();
flowsApi.use('*', requireUser);

const aborts = new Map<string, AbortController>();
const toFlow = (r: any) => ({ id: r.id, name: r.name, steps: JSON.parse(r.steps) as FlowStep[], updatedAt: r.updated_at });
const own = (userId: string, id: string) => db.prepare('SELECT * FROM flows WHERE id=? AND user_id=?').get(id, userId) as any;
const toRun = (r: any) => ({ id: r.id, flowId: r.flow_id, input: r.input, status: r.status, results: JSON.parse(r.results) as RunResults, startedAt: r.started_at, finishedAt: r.finished_at });

function resolveBot(userId: string, name: string) {
  return db.prepare("SELECT id, name FROM bots WHERE user_id=? AND kind!='room' AND (lower(name)=lower(?) OR id=?)").get(userId, name.trim(), name.trim()) as { id: string; name: string } | undefined;
}

/** Send the prompt to the bot like a typed message and return what it answered once its queue has drained. */
export async function askBot(userId: string, botName: string, prompt: string): Promise<string> {
  const bot = resolveBot(userId, botName);
  if (!bot) throw new Error(`No bot called "${botName}".`);
  const row = appendRow(bot.id, 'message', { type: 'message', role: 'user', text: prompt, from: { kind: 'routine', id: 'flow', name: 'Flow' } });
  enqueue(bot.id, { type: 'user', text: prompt });
  await runInBotQueue(bot.id, async () => {});
  const rows = listRows(bot.id, { limit: 200 }).filter((r) => r.seq > row.seq);
  const text = rows.flatMap((r) => (r.body.type === 'message' && r.body.role === 'assistant' && r.body.text ? [r.body.text] : [])).join('\n\n').trim();
  const err = rows.find((r) => (r.body as any).type === 'notice' && (r.body as any).tone === 'error') as any;
  if (!text && err) throw new Error(err.body.text);
  if (!text) throw new Error(`${getBotRow(bot.id).name} did not answer.`);
  return text;
}

flowsApi.get('/', (c) => c.json({ flows: (db.prepare('SELECT * FROM flows WHERE user_id=? ORDER BY updated_at DESC').all(c.get('user').id) as any[]).map(toFlow) }));

flowsApi.put('/', async (c) => {
  const b = await c.req.json<{ id?: string; name?: string; steps?: FlowStep[] }>().catch(() => ({} as any));
  const name = String(b.name ?? '').trim();
  if (!name) return c.json({ error: 'Give the flow a name.' }, 400);
  const steps = ((b.steps ?? []) as FlowStep[]).map((s: FlowStep) => ({ id: String(s.id ?? '').trim(), bot: String(s.bot ?? '').trim(), prompt: String(s.prompt ?? '').trim(), needs: (s.needs ?? []).map(String), retries: Math.max(0, Math.min(Number(s.retries ?? 0) || 0, 3)) }));
  const bad = validate(steps);
  if (bad) return c.json({ error: bad }, 400);
  const userId = c.get('user').id;
  const unknown = steps.find((s: FlowStep) => !resolveBot(userId, s.bot));
  if (unknown) return c.json({ error: `Step "${unknown.id}": no bot called "${unknown.bot}".` }, 400);
  const id = b.id && own(userId, b.id) ? b.id : newId('flw');
  db.prepare('INSERT INTO flows(id,user_id,name,steps,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, steps=excluded.steps, updated_at=excluded.updated_at')
    .run(id, userId, name, JSON.stringify(steps), now(), now());
  return c.json({ flow: toFlow(own(userId, id)) });
});

flowsApi.delete('/:id', (c) => {
  if (!own(c.get('user').id, c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  db.prepare('DELETE FROM flows WHERE id=?').run(c.req.param('id'));
  return c.json({ ok: true });
});

flowsApi.get('/:id/runs', (c) => {
  if (!own(c.get('user').id, c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  return c.json({ runs: (db.prepare('SELECT * FROM flow_runs WHERE flow_id=? ORDER BY started_at DESC LIMIT 20').all(c.req.param('id')) as any[]).map(toRun) });
});

export function startFlowRun(userId: string, flowId: string, input: string): string {
  const f = own(userId, flowId);
  if (!f) throw new Error('Flow not found.');
  const steps = JSON.parse(f.steps) as FlowStep[];
  const runId = newId('run');
  const ctl = new AbortController();
  aborts.set(runId, ctl);
  const save = (status: string, results: RunResults, done = false) =>
    db.prepare('UPDATE flow_runs SET status=?, results=?, finished_at=? WHERE id=?').run(status, JSON.stringify(results), done ? now() : null, runId);
  const initial = Object.fromEntries(steps.map((s) => [s.id, { status: 'pending', attempts: 0 }]));
  db.prepare('INSERT INTO flow_runs(id,flow_id,input,status,results,started_at) VALUES (?,?,?,?,?,?)').run(runId, flowId, input, 'running', JSON.stringify(initial), now());
  void runFlow(steps, { input, signal: ctl.signal, concurrency: 3, exec: (s, p) => askBot(userId, s.bot, p), onUpdate: (r) => save('running', r) })
    .then((r) => save(r.status, r.results, true))
    .catch((e) => save('failed', { error: { status: 'failed', error: String(e?.message ?? e), attempts: 0 } }, true))
    .finally(() => aborts.delete(runId));
  return runId;
}

flowsApi.post('/:id/run', async (c) => {
  const { input } = await c.req.json<{ input?: string }>().catch(() => ({} as { input?: string }));
  try { return c.json({ runId: startFlowRun(c.get('user').id, c.req.param('id'), String(input ?? '')) }); }
  catch (e: any) { return c.json({ error: e.message }, 404); }
});

flowsApi.get('/runs/:runId', (c) => {
  const r = db.prepare('SELECT r.* FROM flow_runs r JOIN flows f ON f.id=r.flow_id WHERE r.id=? AND f.user_id=?').get(c.req.param('runId'), c.get('user').id) as any;
  return r ? c.json({ run: toRun(r) }) : c.json({ error: 'not found' }, 404);
});

flowsApi.post('/runs/:runId/stop', (c) => {
  const r = db.prepare('SELECT r.id FROM flow_runs r JOIN flows f ON f.id=r.flow_id WHERE r.id=? AND f.user_id=?').get(c.req.param('runId'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  aborts.get(r.id)?.abort();
  return c.json({ ok: true });
});
