import { Hono } from 'hono';
import { Cron } from 'croner';
import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import { enqueue, interrupt, requestApproval, runInBotQueue } from './agent/loop.js';
import { appendRow, getBotRow, listRows } from './store.js';
import { planPrompt, parsePlan } from './flow-plan.js';
import { runFlow, validate, type FlowStep, type RunResults } from './flow.js';

db.exec(`
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE, input TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, results TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER
);`);
try { db.exec("ALTER TABLE flows ADD COLUMN schedule TEXT NOT NULL DEFAULT ''"); } catch (e: any) { if (!/duplicate column/i.test(e?.message)) throw e; }

/** Multi-agent workflows: /api/flows. Each step is a message to one of the user's bots; independent steps run in parallel. */
export const flowsApi = new Hono<AuthVars>();
flowsApi.use('*', requireUser);

const aborts = new Map<string, AbortController>();
const toFlow = (r: any) => ({ id: r.id, name: r.name, steps: JSON.parse(r.steps) as FlowStep[], schedule: (r.schedule ?? '') as string, updatedAt: r.updated_at });
const own = (userId: string, id: string) => db.prepare('SELECT * FROM flows WHERE id=? AND user_id=?').get(id, userId) as any;
const toRun = (r: any) => ({ id: r.id, flowId: r.flow_id, input: r.input, status: r.status, results: JSON.parse(r.results) as RunResults, startedAt: r.started_at, finishedAt: r.finished_at });

function resolveBot(userId: string, name: string) {
  return db.prepare("SELECT id, name FROM bots WHERE user_id=? AND kind!='room' AND (lower(name)=lower(?) OR id=?)").get(userId, name.trim(), name.trim()) as { id: string; name: string } | undefined;
}

/** A workflow step marked "ask me first": an approval card in that bot's chat; true = allowed. Allow/Always both mean yes. */
export async function askGate(userId: string, step: FlowStep, prompt: string): Promise<boolean> {
  const bot = resolveBot(userId, step.bot);
  if (!bot) return false;
  const d = await requestApproval({ userId, botId: bot.id }, { key: 'flow_step', title: `Workflow: run step "${step.id}"` }, { step: step.id, instructions: prompt.slice(0, 500) }, null);
  return d === 'allow';
}

/** Send the prompt to the bot like a typed message and return what it answered once its queue has drained. */
export async function askBot(userId: string, botName: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const bot = resolveBot(userId, botName);
  if (!bot) throw new Error(`No bot called "${botName}".`);
  const row = appendRow(bot.id, 'message', { type: 'message', role: 'user', text: prompt, from: { kind: 'routine', id: 'flow', name: 'Flow' } });
  enqueue(bot.id, { type: 'user', text: prompt });
  const stop = () => interrupt(bot.id);
  signal?.addEventListener('abort', stop, { once: true });
  try { await runInBotQueue(bot.id, async () => {}); } finally { signal?.removeEventListener('abort', stop); }
  if (signal?.aborted) throw new Error('Stopped.');
  // only what the bot wrote for THIS prompt: rows after ours, up to the next message from someone else
  const after = listRows(bot.id, { limit: 500 }).filter((r) => r.seq > row.seq);
  const next = after.findIndex((r) => r.body.type === 'message' && r.body.role === 'user');
  const rows = next < 0 ? after : after.slice(0, next);
  const text = rows.flatMap((r) => (r.body.type === 'message' && r.body.role === 'assistant' && r.body.text ? [r.body.text] : [])).join('\n\n').trim();
  const err = rows.find((r) => (r.body as any).type === 'notice' && (r.body as any).tone === 'error') as any;
  if (!text && err) throw new Error(err.body.text);
  if (!text) throw new Error(`${getBotRow(bot.id).name} did not answer.`);
  return text;
}

flowsApi.get('/', (c) => c.json({ flows: (db.prepare('SELECT * FROM flows WHERE user_id=? ORDER BY updated_at DESC').all(c.get('user').id) as any[]).map(toFlow) }));

flowsApi.put('/', async (c) => {
  const b = await c.req.json<{ id?: string; name?: string; steps?: FlowStep[]; schedule?: string }>().catch(() => ({} as any));
  const name = String(b.name ?? '').trim();
  if (!name) return c.json({ error: 'Give the flow a name.' }, 400);
  const steps = ((b.steps ?? []) as FlowStep[]).map((s: FlowStep) => ({ id: String(s.id ?? '').trim(), bot: String(s.bot ?? '').trim(), prompt: String(s.prompt ?? '').trim(), needs: (s.needs ?? []).map(String), retries: Math.max(0, Math.min(Number(s.retries ?? 0) || 0, 3)), ...(s.gate ? { gate: true } : {}) }));
  const bad = validate(steps);
  if (bad) return c.json({ error: bad }, 400);
  const userId = c.get('user').id;
  const unknown = steps.find((s: FlowStep) => !resolveBot(userId, s.bot));
  if (unknown) return c.json({ error: `Step "${unknown.id}": no bot called "${unknown.bot}".` }, 400);
  const schedule = String(b.schedule ?? '').trim();
  if (schedule) { try { new Cron(schedule, { paused: true }); } catch { return c.json({ error: `"${schedule}" is not a valid cron schedule (example: 0 9 * * 1-5).` }, 400); } }
  const id = b.id && own(userId, b.id) ? b.id : newId('flw');
  db.prepare('INSERT INTO flows(id,user_id,name,steps,schedule,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, steps=excluded.steps, schedule=excluded.schedule, updated_at=excluded.updated_at')
    .run(id, userId, name, JSON.stringify(steps), schedule, now(), now());
  scheduleFlow(id, userId, schedule);
  return c.json({ flow: toFlow(own(userId, id)) });
});

/** Draft steps from a goal: one of the user's bots acts as planner. Nothing is saved; the UI loads the draft into the editor. */
flowsApi.post('/plan', async (c) => {
  const b = await c.req.json<{ goal?: string; bot?: string }>().catch(() => ({} as any));
  const goal = String(b.goal ?? '').trim();
  if (!goal) return c.json({ error: 'Write the goal first.' }, 400);
  const userId = c.get('user').id;
  const bots = (db.prepare("SELECT name FROM bots WHERE user_id=? AND kind!='room' ORDER BY created_at").all(userId) as { name: string }[]).map((r) => r.name);
  if (!bots.length) return c.json({ error: 'Create a Bot first.' }, 400);
  const planner = (b.bot && resolveBot(userId, b.bot)?.name) || bots[0];
  try { return c.json({ steps: parsePlan(await askBot(userId, planner, planPrompt(goal, bots)), bots), planner }); }
  catch (e: any) { return c.json({ error: e.message }, 502); }
});

flowsApi.delete('/:id', (c) => {
  if (!own(c.get('user').id, c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  scheduleFlow(c.req.param('id'), '', '');
  db.prepare('DELETE FROM flows WHERE id=?').run(c.req.param('id'));
  return c.json({ ok: true });
});

flowsApi.get('/:id/runs', (c) => {
  if (!own(c.get('user').id, c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  return c.json({ runs: (db.prepare('SELECT * FROM flow_runs WHERE flow_id=? ORDER BY started_at DESC LIMIT 20').all(c.req.param('id')) as any[]).map(toRun) });
});

/** `resumeFrom`: continue an earlier run of this flow (its finished steps are kept, the rest run again). */
export function startFlowRun(userId: string, flowId: string, input: string, resumeFrom?: RunResults): string {
  const f = own(userId, flowId);
  if (!f) throw new Error('Flow not found.');
  const steps = JSON.parse(f.steps) as FlowStep[];
  const runId = newId('run');
  const ctl = new AbortController();
  aborts.set(runId, ctl);
  let last: RunResults = {};
  const save = (status: string, results: RunResults, done = false) => {
    last = results;
    db.prepare('UPDATE flow_runs SET status=?, results=?, finished_at=? WHERE id=?').run(status, JSON.stringify(results), done ? now() : null, runId);
  };
  const initial = Object.fromEntries(steps.map((s) => [s.id, resumeFrom?.[s.id]?.status === 'done' ? resumeFrom[s.id] : { status: 'pending', attempts: 0 }]));
  db.prepare('INSERT INTO flow_runs(id,flow_id,input,status,results,started_at) VALUES (?,?,?,?,?,?)').run(runId, flowId, input, 'running', JSON.stringify(initial), now());
  void runFlow(steps, { input, signal: ctl.signal, concurrency: 3, resume: resumeFrom, approve: (s, p) => askGate(userId, s, p), exec: (s, p) => askBot(userId, s.bot, p, ctl.signal), onUpdate: (r) => save('running', r) })
    .then((r) => save(r.status, r.results, true))
    .catch((e) => save('failed', { ...last, _run: { status: 'failed', error: String(e?.message ?? e), attempts: 0 } }, true))
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

flowsApi.post('/runs/:runId/resume', (c) => {
  const r = db.prepare('SELECT r.* FROM flow_runs r JOIN flows f ON f.id=r.flow_id WHERE r.id=? AND f.user_id=?').get(c.req.param('runId'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  if (r.status === 'running' || r.status === 'done') return c.json({ error: `This run is ${r.status}; only failed or stopped runs can continue.` }, 409);
  if (db.prepare("SELECT 1 FROM flow_runs WHERE flow_id=? AND status='running'").get(r.flow_id)) return c.json({ error: 'This flow already has a run going.' }, 409);
  try { return c.json({ runId: startFlowRun(c.get('user').id, r.flow_id, r.input, JSON.parse(r.results)) }); }
  catch (e: any) { return c.json({ error: e.message }, 404); }
});

flowsApi.post('/runs/:runId/stop', (c) => {
  const r = db.prepare('SELECT r.id FROM flow_runs r JOIN flows f ON f.id=r.flow_id WHERE r.id=? AND f.user_id=?').get(c.req.param('runId'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  aborts.get(r.id)?.abort();
  return c.json({ ok: true });
});

const crons = new Map<string, Cron>();
const firedKey = (flowId: string) => `flowcron:${flowId}`;
const markFired = (flowId: string, t = Date.now()) => { db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(firedKey(flowId), String(t)); };
const CATCHUP_MS = 24 * 3600_000;

/** A scheduled time that passed while the computer was off or asleep: true if one fell in the last 24 h after the last fire. */
export function missedRun(schedule: string, lastFired: number | null, at = Date.now()): boolean {
  const prev = new Cron(schedule, { paused: true }).previousRuns(1, new Date(at))[0];
  return !!prev && at - prev.getTime() < CATCHUP_MS && prev.getTime() > (lastFired ?? 0);
}
/** Cron-triggered flows: an empty schedule removes the job. A run is skipped while the previous one of the same flow is still going. */
export function scheduleFlow(flowId: string, userId: string, schedule: string) {
  crons.get(flowId)?.stop();
  crons.delete(flowId);
  if (!schedule) return;
  crons.set(flowId, new Cron(schedule, () => {
    markFired(flowId);
    // croner's protect does not wait for our (instant-returning) handler, so check the run table ourselves
    if (db.prepare("SELECT 1 FROM flow_runs WHERE flow_id=? AND status='running'").get(flowId)) return;
    try { startFlowRun(userId, flowId, ''); } catch (e) { console.warn('[flows] scheduled run failed', flowId, (e as Error).message); }
  }));
}

/** Runs that were in flight when the server stopped can never finish: mark them failed (finished steps stay, so "Continue" can resume) so the UI and the overlap guard are not stuck. */
export function reconcileRuns() {
  const r = db.prepare("UPDATE flow_runs SET status='failed', finished_at=? WHERE status='running'").run(now());
  if (r.changes) console.log(`[flows] ${r.changes} run(s) were interrupted by the restart`);
}

export function initFlowSchedules() {
  reconcileRuns();
  for (const f of db.prepare("SELECT id, user_id, schedule FROM flows WHERE schedule!=''").all() as any[]) {
    try {
      scheduleFlow(f.id, f.user_id, f.schedule);
      const last = (db.prepare('SELECT value FROM kv WHERE key=?').get(firedKey(f.id)) as any)?.value;
      // first time seen: start the clock now rather than firing an old slot
      if (last === undefined) markFired(f.id);
      else if (missedRun(f.schedule, Number(last))) { markFired(f.id); startFlowRun(f.user_id, f.id, ''); console.log('[flows] catching up a missed run of', f.id); }
    } catch (e) { console.warn('[flows] bad schedule', f.id, (e as Error).message); }
  }
  console.log(`[flows] scheduled ${crons.size}`);
}

export const listFlows = (userId: string) => (db.prepare('SELECT * FROM flows WHERE user_id=? ORDER BY name').all(userId) as any[]).map(toFlow);
export const findFlow = (userId: string, ref: string) =>
  db.prepare('SELECT * FROM flows WHERE user_id=? AND (id=? OR lower(name)=lower(?))').get(userId, ref.trim(), ref.trim()) as any;
