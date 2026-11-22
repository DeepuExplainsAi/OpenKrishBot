/** Per-provider circuit breaker (idea from paperclip's retry/health code): after a provider fails in a way another
 * provider would not, skip it for a short while instead of making every message wait through its retries. */
const COOLDOWN_MS = Number(process.env.KRISH_BREAKER_MS ?? 60_000);
const THRESHOLD = 2;
const state = new Map<string, { fails: number; until: number }>();

export const isOpen = (id: string, now = Date.now()) => (state.get(id)?.until ?? 0) > now;
export function recordFailure(id: string, now = Date.now()) {
  const s = state.get(id) ?? { fails: 0, until: 0 };
  s.fails += 1;
  if (s.fails >= THRESHOLD) s.until = now + COOLDOWN_MS;
  state.set(id, s);
}
export const recordSuccess = (id: string) => { state.delete(id); };
export const resetBreakers = () => state.clear();
