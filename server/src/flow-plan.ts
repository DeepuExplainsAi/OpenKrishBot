import { validate, type FlowStep } from './flow.js';

/** OpenManus PlanningFlow idea: a planner bot turns a goal into steps (bot + needs), then the normal flow runner executes them. */
export function planPrompt(goal: string, bots: string[]): string {
  return `Break this goal into workflow steps. Reply with ONLY a JSON array, no other text.
Each item: {"id":"short_lowercase_id","bot":"<one of: ${bots.join(', ')}>","prompt":"what that bot should do","needs":["ids of steps it waits for"]}.
A prompt may use {{input}} and {{earlier_step_id}} for earlier answers. Steps that do not depend on each other must not list each other in needs. 2 to 6 steps.
Goal: ${goal}`;
}

export function parsePlan(text: string, bots: string[]): FlowStep[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('The planner did not return a plan.');
  let raw: any;
  try { raw = JSON.parse(m[0]); } catch { throw new Error('The planner returned a plan that is not valid JSON.'); }
  if (!Array.isArray(raw)) throw new Error('The planner did not return a list of steps.');
  const byName = new Map(bots.map((b) => [b.toLowerCase(), b]));
  const norm = (v: unknown) => String(v).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const steps: FlowStep[] = raw.map((s: any, i: number) => ({
    id: norm(s?.id ?? `step${i + 1}`) || `step${i + 1}`,
    bot: byName.get(String(s?.bot ?? '').trim().toLowerCase()) ?? bots[0],
    prompt: String(s?.prompt ?? '').trim(),
    needs: Array.isArray(s?.needs) ? s.needs.map(norm) : [],
    retries: 0,
  }));
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) s.needs = s.needs!.filter((n) => ids.has(n) && n !== s.id);
  const bad = validate(steps);
  if (bad) throw new Error(`The planner's plan is not usable: ${bad}`);
  return steps;
}
