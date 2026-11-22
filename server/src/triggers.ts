import { Hono } from 'hono';
import { db, now } from './db.js';
import { newId, token } from './lib/ids.js';
import { env } from './env.js';
import { enqueue } from './agent/loop.js';
import { appendRow, getBotRow } from './store.js';
import { allHold, parseConditions, type Condition } from './conditions.js';
import { fetchFeed } from './feed.js';

/**
 * Event routines: a routine whose schedule is `event:<secret>` runs when something POSTs to
 * /hooks/<secret> on this computer. Works with anything that can send a web request (scripts,
 * IFTTT-style tools, GitHub webhooks through a tunnel the user runs).
 */
export const hooks = new Hono();

export const isEventSchedule = (schedule: string) => schedule.startsWith('event:');
export const describeEvent = (schedule: string) => (isEventSchedule(schedule) ? 'When its webhook is called' : schedule);
export const hookUrl = (schedule: string) => `${env.appUrl}/hooks/${schedule.slice('event:'.length)}`;

export const isFeedSchedule = (schedule: string) => schedule.startsWith('feed:');
export const isTriggerSchedule = (schedule: string) => isEventSchedule(schedule) || isFeedSchedule(schedule);

export function createWebhookRoutine(botId: string, r: { name: string; prompt: string; conditions?: unknown }) {
  const conditions = parseConditions(r.conditions);
  const id = newId('rt');
  const schedule = `event:${token().slice(0, 24)}`;
  db.prepare('INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at,conditions) VALUES (?,?,?,?,?,?,1,?,?)').run(id, botId, r.name, r.prompt, schedule, 'UTC', now(), conditions.length ? JSON.stringify(conditions) : null);
  return { id, schedule, url: hookUrl(schedule) };
}


hooks.post('/:secret', async (c) => {
  const row = db.prepare("SELECT * FROM routines WHERE schedule=? AND enabled=1").get(`event:${c.req.param('secret')}`) as any;
  if (!row || !getBotRow(row.bot_id)) return c.json({ error: 'not found' }, 404);
  const payload = (await c.req.text()).slice(0, 8000);
  const conds: Condition[] = row.conditions ? JSON.parse(row.conditions) : [];
  if (conds.length) {
    let data: unknown; try { data = JSON.parse(payload); } catch { data = {}; }
    if (!allHold(conds, data)) return c.json({ ok: true, skipped: 'conditions not met' });
  }
  db.prepare('UPDATE routines SET last_run_at=? WHERE id=?').run(now(), row.id);
  appendRow(row.bot_id, 'event', { type: 'event', event: 'routine-run', text: `Running routine: ${row.name}`, ref: row.id });
  enqueue(row.bot_id, { type: 'routine', routineId: row.id, name: row.name, prompt: payload ? `${row.prompt}\n\nThe event sent:\n${payload}` : row.prompt });
  return c.json({ ok: true });
});

// ---------- feed triggers: a routine whose schedule is `feed:<url>` runs for each NEW item ----------

export function createFeedRoutine(botId: string, r: { name: string; prompt: string; url: string; conditions?: unknown }) {
  if (!/^https?:\/\//i.test(r.url)) throw new Error('The feed address must start with http:// or https://');
  const conditions = parseConditions(r.conditions);
  const id = newId('rt');
  db.prepare('INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at,conditions) VALUES (?,?,?,?,?,?,1,?,?)').run(id, botId, r.name, r.prompt, `feed:${r.url}`, 'UTC', now(), conditions.length ? JSON.stringify(conditions) : null);
  return { id };
}

const MAX_PER_POLL = 5;

/** One poll of one feed routine. The first poll only remembers what is already there, so old posts don't fire. */
export async function pollFeedRoutine(row: any, fetchImpl: typeof fetch = fetch): Promise<number> {
  const items = await fetchFeed(row.schedule.slice('feed:'.length), fetchImpl);
  const first = row.seen == null;
  const seen = new Set<string>(row.seen ? JSON.parse(row.seen) : []);
  const fresh = items.filter((i) => i.id && !seen.has(i.id));
  for (const i of items) if (i.id) seen.add(i.id);
  db.prepare('UPDATE routines SET seen=? WHERE id=?').run(JSON.stringify([...seen].slice(-500)), row.id);
  if (first) return 0;
  const conds: Condition[] = row.conditions ? JSON.parse(row.conditions) : [];
  let fired = 0;
  for (const item of fresh.reverse().filter((i) => allHold(conds, i)).slice(0, MAX_PER_POLL)) {
    db.prepare('UPDATE routines SET last_run_at=? WHERE id=?').run(now(), row.id);
    appendRow(row.bot_id, 'event', { type: 'event', event: 'routine-run', text: `New in feed: ${item.title || item.link}`, ref: row.id });
    enqueue(row.bot_id, { type: 'routine', routineId: row.id, name: row.name, prompt: `${row.prompt}\n\nA new item appeared in the feed:\n${JSON.stringify(item, null, 2)}` });
    fired++;
  }
  return fired;
}

export function startFeedPolling(everyMs = 15 * 60_000) {
  const tick = async () => {
    for (const row of db.prepare("SELECT * FROM routines WHERE enabled=1 AND schedule LIKE 'feed:%'").all() as any[]) {
      try { await pollFeedRoutine(row); } catch (e: any) { console.warn('[feeds]', row.name, e.message); }
    }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, everyMs).unref();
}
