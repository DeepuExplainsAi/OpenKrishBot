import { db, now } from './db.js';
import { newId } from './lib/ids.js';
import type { PlanStep, StepStatus } from './types.js';

/**
 * OpenManus's planning tool, on top of Krishbot's tasks: a plan is a task whose steps the Bot ticks off.
 * Pure functions over a steps list, so they can be tested; `tools.ts` wires them to the database.
 */

const STATUSES: StepStatus[] = ['todo', 'doing', 'done', 'blocked'];
const MARK: Record<StepStatus, string> = { todo: '[ ]', doing: '[→]', done: '[✓]', blocked: '[!]' };

export const newSteps = (texts: string[]): PlanStep[] =>
  texts.map((t) => String(t).trim()).filter(Boolean).slice(0, 30).map((text, i) => ({ text, status: i === 0 ? 'doing' : 'todo' }));

export function render(title: string, steps: PlanStep[]): string {
  const done = steps.filter((s) => s.status === 'done').length;
  return `Plan: ${title} (${done}/${steps.length} done)\n${steps.map((s, i) => `${i}. ${MARK[s.status]} ${s.text}${s.note ? ` — ${s.note}` : ''}`).join('\n')}`;
}

/** Marks a step. Finishing a step moves "doing" to the next one that is still to do. */
export function markStep(steps: PlanStep[], index: number, status: string, note?: string): { steps: PlanStep[]; error?: string } {
  if (!Number.isInteger(index) || index < 0 || index >= steps.length) return { steps, error: `There is no step ${index}. Steps run from 0 to ${steps.length - 1}.` };
  if (!STATUSES.includes(status as StepStatus)) return { steps, error: `status must be one of ${STATUSES.join(', ')}.` };
  const next = steps.map((s, i) => (i === index ? { ...s, status: status as StepStatus, ...(note ? { note } : {}) } : { ...s }));
  if ((status === 'done' || status === 'blocked') && !next.some((s) => s.status === 'doing')) {
    const upcoming = next.find((s) => s.status === 'todo');
    if (upcoming) upcoming.status = 'doing';
  }
  return { steps: next };
}

/** The plan a Bot is working on: its newest task that has steps and is not finished. */
export function activePlan(botId: string): { id: string; title: string; steps: PlanStep[] } | null {
  const r = db.prepare("SELECT id, title, steps FROM tasks WHERE bot_id=? AND state!='done' AND steps!='[]' ORDER BY updated_at DESC LIMIT 1").get(botId) as any;
  return r ? { id: r.id, title: r.title, steps: JSON.parse(r.steps) } : null;
}

export function createPlan(botId: string, title: string, texts: string[]): { id: string; steps: PlanStep[] } {
  const steps = newSteps(texts);
  const id = newId('task');
  db.prepare("INSERT INTO tasks(id,bot_id,title,state,steps,created_at,updated_at) VALUES (?,?,?,'working',?,?,?)").run(id, botId, title, JSON.stringify(steps), now(), now());
  return { id, steps };
}

export function saveSteps(id: string, steps: PlanStep[]): 'working' | 'needs_input' | 'done' {
  const state = steps.every((s) => s.status === 'done') ? 'done' : steps.some((s) => s.status === 'blocked') && !steps.some((s) => s.status === 'doing') ? 'needs_input' : 'working';
  db.prepare('UPDATE tasks SET steps=?, state=?, updated_at=? WHERE id=?').run(JSON.stringify(steps), state, now(), id);
  return state;
}

/**
 * OpenManus's stuck check: the same tool call with the same arguments again and again means the model is looping.
 * Returns a nudge to add to the tool result once it has happened `limit` times in a row.
 */
export function loopNudge(recent: string[], call: string, limit = 3): string | null {
  recent.push(call);
  if (recent.length > limit) recent.shift();
  return recent.length === limit && recent.every((c) => c === call)
    ? 'You have made this exact call several times with the same result. Stop repeating it: try a different approach, or tell the user what is blocking you.'
    : null;
}
