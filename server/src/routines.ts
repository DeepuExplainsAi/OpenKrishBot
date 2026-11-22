import { Cron } from 'croner';
import { db, now } from './db.js';
import { appendRow } from './store.js';
import type { Routine } from './types.js';
import { isTriggerSchedule } from './triggers.js';

const jobs = new Map<string, Cron>();
let enqueueFn: ((botId: string, t: any) => void) | null = null;

export function initRoutines(enqueue: (botId: string, t: any) => void) {
  enqueueFn = enqueue;
  const all = db.prepare("SELECT * FROM routines WHERE enabled=1 AND schedule NOT LIKE 'event:%' AND schedule NOT LIKE 'feed:%'").all() as any[];
  for (const r of all) {
    scheduleRoutine({ id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone } as Routine);
    if (missedSince(r.schedule, r.timezone, r.last_run_at ?? r.created_at)) runRoutine(r.id);
  }
  console.log(`[routines] scheduled ${jobs.size}`);
}

const CATCHUP_MS = 24 * 3600_000;

/** A run was due while the app was off: the latest scheduled time in the last 24 h falls after `since` (last run, or creation). Runs once, not once per missed time. */
export function missedSince(schedule: string, timezone: string | null, since: number, at = Date.now()): boolean {
  if (isTriggerSchedule(schedule)) return false;
  try {
    const prev = new Cron(schedule, { paused: true, timezone: timezone || 'UTC' }).previousRuns(1, new Date(at))[0];
    return !!prev && at - prev.getTime() < CATCHUP_MS && prev.getTime() > since;
  } catch { return false; }
}

export function scheduleRoutine(r: Pick<Routine, 'id' | 'botId' | 'name' | 'prompt' | 'schedule' | 'timezone'>) {
  if (isTriggerSchedule(r.schedule)) return;
  unscheduleRoutine(r.id);
  try {
    const job = new Cron(r.schedule, { timezone: r.timezone || 'UTC', protect: true }, () => runRoutine(r.id));
    jobs.set(r.id, job);
  } catch (e) {
    console.warn('[routines] bad schedule', r.id, r.schedule, (e as Error).message);
  }
}

export function unscheduleRoutine(id: string) {
  jobs.get(id)?.stop();
  jobs.delete(id);
}

export function runRoutine(id: string) {
  const r = db.prepare('SELECT * FROM routines WHERE id=?').get(id) as any;
  if (!r || !enqueueFn) return;
  db.prepare('UPDATE routines SET last_run_at=? WHERE id=?').run(now(), id);
  appendRow(r.bot_id, 'event', { type: 'event', event: 'routine-run', text: `Running routine: ${r.name}`, ref: id });
  enqueueFn(r.bot_id, { type: 'routine', routineId: id, name: r.name, prompt: r.prompt });
}
