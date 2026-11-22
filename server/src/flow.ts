/**
 * Multi-agent workflows (n8n-style graph, OpenManus planning, Paperclip task hand-off): a flow is steps, each
 * given to a bot, with `needs` edges. Steps whose needs are done run in parallel; a step sees the outputs of its
 * needs through {{step_id}} and the run's input through {{input}}. A failed step skips everything downstream.
 * Pure scheduling here; the bot call is injected so it can be tested.
 */
export interface FlowStep { id: string; bot: string; prompt: string; needs?: string[]; retries?: number }
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface StepResult { status: StepStatus; output?: string; error?: string; attempts: number; startedAt?: number; finishedAt?: number }
export type RunResults = Record<string, StepResult>;

export function validate(steps: FlowStep[]): string | null {
  if (!steps.length) return 'Add at least one step.';
  if (steps.length > 30) return 'A flow can have at most 30 steps.';
  const ids = new Set<string>();
  for (const s of steps) {
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(s.id ?? '')) return `Step id "${s.id}" must be lowercase letters, digits or _ and start with a letter.`;
    if (ids.has(s.id)) return `Two steps are called "${s.id}".`;
    ids.add(s.id);
    if (!String(s.bot ?? '').trim()) return `Step "${s.id}" needs a bot.`;
    if (!String(s.prompt ?? '').trim()) return `Step "${s.id}" needs instructions.`;
  }
  for (const s of steps) for (const n of s.needs ?? []) if (!ids.has(n)) return `Step "${s.id}" needs "${n}", which does not exist.`;
  // cycle check (Kahn)
  const left = new Map(steps.map((s) => [s.id, new Set(s.needs ?? [])]));
  let moved = true;
  while (left.size && moved) {
    moved = false;
    for (const [id, deps] of [...left]) if (!deps.size) { left.delete(id); for (const d of left.values()) d.delete(id); moved = true; }
  }
  return left.size ? `These steps wait on each other in a loop: ${[...left.keys()].join(', ')}.` : null;
}

export function fill(template: string, input: string, results: RunResults): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k === 'input' ? input : results[k]?.status === 'done' ? results[k].output ?? '' : m));
}

const STEP_TIMEOUT_MS = 20 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 60000)} min and was stopped.`)), ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('Stopped.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); });
  });
}

export interface RunOptions {
  input: string;
  concurrency?: number;
  signal?: AbortSignal;
  /** Give up on one step after this long (default 20 min) so a hung model never leaves a run open forever. */
  stepTimeoutMs?: number;
  /** First retry waits this long, then doubles (default 2 s). */
  retryBaseMs?: number;
  /** Results of an earlier run of the same steps: finished steps keep their output, everything else starts again. */
  resume?: RunResults;
  exec: (step: FlowStep, prompt: string) => Promise<string>;
  onUpdate?: (results: RunResults) => void;
}

export async function runFlow(steps: FlowStep[], o: RunOptions): Promise<{ status: 'done' | 'failed' | 'stopped'; results: RunResults }> {
  const bad = validate(steps);
  if (bad) throw new Error(bad);
  const results: RunResults = Object.fromEntries(steps.map((s) => [s.id, o.resume?.[s.id]?.status === 'done' ? structuredClone(o.resume[s.id]) : ({ status: 'pending', attempts: 0 } as StepResult)]));
  const max = Math.max(1, Math.min(o.concurrency ?? 3, 8));
  let running = 0;
  const notify = () => o.onUpdate?.(structuredClone(results));

  await new Promise<void>((resolve) => {
    const pump = () => {
      // downstream of a failure never runs
      for (const s of steps) {
        const r = results[s.id];
        if (r.status === 'pending' && (s.needs ?? []).some((n) => results[n].status === 'failed' || results[n].status === 'skipped')) { r.status = 'skipped'; r.finishedAt = Date.now(); }
      }
      if (o.signal?.aborted) { for (const s of steps) if (results[s.id].status === 'pending') results[s.id].status = 'skipped'; }
      for (const s of steps) {
        if (running >= max || o.signal?.aborted) break;
        const r = results[s.id];
        if (r.status !== 'pending' || !(s.needs ?? []).every((n) => results[n].status === 'done')) continue;
        running++; r.status = 'running'; r.startedAt = Date.now();
        void (async () => {
          const prompt = fill(s.prompt, o.input, results);
          const tries = 1 + Math.max(0, Math.min(s.retries ?? 0, 3));
          for (let a = 1; a <= tries; a++) {
            r.attempts = a;
            try { r.output = await withTimeout(o.exec(s, prompt), o.stepTimeoutMs ?? STEP_TIMEOUT_MS, `Step "${s.id}"`, o.signal); r.status = 'done'; r.error = undefined; break; }
            catch (e: any) {
              r.error = String(e?.message ?? e); r.status = 'failed';
              if (o.signal?.aborted || a === tries) break;
              await new Promise((res) => setTimeout(res, Math.min((o.retryBaseMs ?? 2000) * 2 ** (a - 1), 30_000)));
            }
          }
          r.finishedAt = Date.now(); running--; notify(); pump();
        })();
      }
      notify();
      if (!running && steps.every((s) => ['done', 'failed', 'skipped'].includes(results[s.id].status))) resolve();
    };
    pump();
  });
  const failed = steps.some((s) => results[s.id].status === 'failed');
  return { status: o.signal?.aborted ? 'stopped' : failed ? 'failed' : 'done', results };
}
