import { Hono } from 'hono';
import { db, now } from './db.js';
import { newId, token } from './lib/ids.js';
import { env } from './env.js';
import { enqueue } from './agent/loop.js';
import { appendRow, getBotRow } from './store.js';

/**
 * Event routines: a routine whose schedule is `event:<secret>` runs when something POSTs to
 * /hooks/<secret> on this computer. Works with anything that can send a web request (scripts,
 * IFTTT-style tools, GitHub webhooks through a tunnel the user runs).
 */
export const hooks = new Hono();

export const isEventSchedule = (schedule: string) => schedule.startsWith('event:');
export const describeEvent = (schedule: string) => (isEventSchedule(schedule) ? 'When its webhook is called' : schedule);
export const hookUrl = (schedule: string) => `${env.appUrl}/hooks/${schedule.slice('event:'.length)}`;

export function createWebhookRoutine(botId: string, r: { name: string; prompt: string }) {
  const id = newId('rt');
  const schedule = `event:${token().slice(0, 24)}`;
  db.prepare('INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)').run(id, botId, r.name, r.prompt, schedule, 'UTC', now());
  return { id, schedule, url: hookUrl(schedule) };
}


hooks.post('/:secret', async (c) => {
  const row = db.prepare("SELECT * FROM routines WHERE schedule=? AND enabled=1").get(`event:${c.req.param('secret')}`) as any;
  if (!row || !getBotRow(row.bot_id)) return c.json({ error: 'not found' }, 404);
  const payload = (await c.req.text()).slice(0, 8000);
  db.prepare('UPDATE routines SET last_run_at=? WHERE id=?').run(now(), row.id);
  appendRow(row.bot_id, 'event', { type: 'event', event: 'routine-run', text: `Running routine: ${row.name}`, ref: row.id });
  enqueue(row.bot_id, { type: 'routine', routineId: row.id, name: row.name, prompt: payload ? `${row.prompt}\n\nThe event sent:\n${payload}` : row.prompt });
  return c.json({ ok: true });
});
