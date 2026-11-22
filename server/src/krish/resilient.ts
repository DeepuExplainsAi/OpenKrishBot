import { isOpen, recordFailure, recordSuccess } from './breaker.js';
import { PRESETS, hasKey, resolve, type Preset } from './providers.js';

/**
 * One model call that survives a flaky provider. Retry only before any output has streamed (a replay is then
 * invisible, like paperclip's "retry only what is safe to repeat"), with bounded attempts and backoff that honours
 * Retry-After. When a provider keeps failing, the next ready provider answers instead, and the user is told.
 */

export type FailKind = 'rate_limit' | 'overloaded' | 'network' | 'timeout' | 'auth' | 'not_found' | 'too_long' | 'bad_request' | 'unknown';
export interface Failure { kind: FailKind; status?: number; retryable: boolean; fallback: boolean; message: string }

const ATTEMPTS = 3;
const BASE_MS = Number(process.env.KRISH_RETRY_BASE_MS ?? 700);
const MAX_WAIT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 45_000;

const codeOf = (e: any): string => { for (let c = e; c; c = c.cause) if (typeof c.code === 'string') return c.code; return ''; };

/** What went wrong, whether trying again can help, whether another provider can help, and what to tell the user. */
export function classify(name: string, status: number | null, body: string, err?: unknown): Failure {
  const detail = (() => { try { const j = JSON.parse(body); return String(j.error?.message ?? j.error ?? j.message ?? '').slice(0, 200); } catch { return body.replace(/\s+/g, ' ').slice(0, 200); } })();
  const F = (kind: FailKind, retryable: boolean, fallback: boolean, message: string): Failure => ({ kind, status: status ?? undefined, retryable, fallback, message });
  if (status === null) {
    const code = codeOf(err);
    if ((err as any)?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return F('timeout', true, true, `${name} did not answer in time.`);
    if (code === 'ECONNREFUSED') return F('network', false, true, `${name} is not running at its address.`);
    return F('network', true, true, `Could not reach ${name}. Check the internet connection.`);
  }
  if (status === 429) return F('rate_limit', true, true, `${name} says you are going too fast or are out of free quota.${detail ? ` (${detail})` : ''}`);
  if (status === 401 || status === 403) return F('auth', false, true, `${name} refused the API key. Check it in the Engine panel.`);
  if (status === 402) return F('auth', false, true, `${name} needs credit on that account.`);
  if (status === 404) return F('not_found', false, true, `${name} does not know that model.${detail ? ` (${detail})` : ''}`);
  if (status === 408 || status === 504) return F('timeout', true, true, `${name} did not answer in time.`);
  if (status >= 500) return F('overloaded', true, true, `${name} is having trouble right now (${status}).`);
  if (status === 413 || /context.{0,20}(length|window)|too (long|many tokens)|maximum context/i.test(detail)) return F('too_long', false, false, 'This conversation is too long for the model. Start a new conversation, or pick a model with a bigger context.');
  return F('bad_request', false, false, `${name} rejected the request (${status}).${detail ? ` ${detail}` : ''}`);
}

export class ModelError extends Error {
  name = 'ModelError';
  constructor(public failure: Failure, public tried: string[]) {
    super(failure.message + (tried.length > 1 ? ` Also tried: ${tried.slice(0, -1).join(', ')}.` : ''));
  }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

/** Seconds or an HTTP date -> ms; capped so a huge value can't freeze a chat. */
function retryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_WAIT_MS) : null;
}

/** Providers that can stand in: ready ones (keyless, or with a key), never the one that already failed. */
export function fallbackChain(first: string | null | undefined, exclude: string[] = []): Preset[] {
  const firstId = resolve(first).preset.id;
  const ready = PRESETS.filter((p) => !exclude.includes(p.id) && p.id !== firstId && p.id !== 'custom' && (hasKey(p.id) || (p.keyless && !p.local)) && p.models.length);
  // keyed providers the user set up come first; the keyless free one is the last resort
  return ready.sort((a, b) => Number(hasKey(b.id)) - Number(hasKey(a.id)));
}

export interface Attempt { res: Response; provider: string; providerName: string; model: string; switchedFrom?: string }

/** `body.model` belongs to the first provider; fallbacks use their own first model. */
export async function callModel(
  botId: string, body: any, provider: string | null | undefined, signal: AbortSignal,
  opts: { fetchImpl?: typeof fetch; onRetry?: (note: string) => void } = {},
): Promise<Attempt> {
  const doFetch = opts.fetchImpl ?? fetch;
  const first = resolve(provider);
  const targets: { preset: Preset; model: string }[] = [
    { preset: first.preset, model: body.model },
    ...fallbackChain(provider).map((p) => ({ preset: p, model: p.models[0] })),
  ];
  const tried: string[] = [];
  let last: Failure | null = null;

  for (const [ti, { preset, model }] of targets.entries()) {
    const { baseUrl, apiKey } = resolve(preset.id);
    // a provider that keeps failing is skipped for a minute, unless it is the only choice left
    if (ti < targets.length - 1 && isOpen(preset.id)) { last ??= { kind: 'overloaded', retryable: true, fallback: true, message: `${preset.name} was failing a moment ago.` }; continue; }
    tried.push(preset.name);
    if (!baseUrl) { last ??= { kind: 'bad_request', retryable: false, fallback: true, message: `${preset.name} has no address yet. Set it in the bot's Engine panel.` }; continue; }
    if (!preset.keyless && !apiKey) { last ??= { kind: 'auth', retryable: false, fallback: true, message: `${preset.name} needs an API key. Add it in the bot's Engine panel, or pick a free provider.` }; continue; }

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('Stopped.');
      let failure: Failure; let wait: number | null = null;
      try {
        const res = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(CONNECT_TIMEOUT_MS)]),
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ ...body, model }),
        });
        if (res.ok && res.body) { recordSuccess(preset.id); return { res, provider: preset.id, providerName: preset.name, model, ...(ti > 0 ? { switchedFrom: targets[0].preset.name } : {}) }; }
        wait = retryAfterMs(res.headers.get('retry-after'));
        failure = classify(preset.name, res.status, await res.text().catch(() => ''));
      } catch (e: any) {
        if (signal.aborted) throw new Error('Stopped.');
        failure = classify(preset.name, null, '', e);
      }
      last = failure;
      if (failure.fallback) recordFailure(preset.id);
      if (!failure.retryable || attempt === ATTEMPTS) break;
      const ms = wait ?? Math.min(BASE_MS * 2 ** (attempt - 1) * (0.75 + Math.random() / 2), MAX_WAIT_MS);
      opts.onRetry?.(`${preset.name} is busy, trying again in ${Math.ceil(ms / 1000)}s…`);
      await sleep(ms, signal);
    }
    // a request the model itself can't take (too long, malformed) fails the same way elsewhere
    if (last && !last.fallback) break;
  }
  throw new ModelError(last ?? { kind: 'unknown', retryable: false, fallback: false, message: 'No model is available.' }, tried);
}
