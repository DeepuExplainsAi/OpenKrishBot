import test from 'node:test';
import assert from 'node:assert/strict';
process.env.KRISH_RETRY_BASE_MS = '1';
process.env.HOME = '/tmp/h-test';
const { callModel, classify, ModelError } = await import('../src/krish/resilient.js');

const ok = () => new Response('data: [DONE]\n\n', { status: 200 });
const fail = (status: number, body = '{}', headers: Record<string, string> = {}) => new Response(body, { status, headers });
const run = (seq: (Response | Error)[], provider = 'pollinations') => {
  const calls: string[] = [];
  const notes: string[] = [];
  const fetchImpl = (async (url: string) => { calls.push(String(url)); const r = seq.shift(); if (!r) throw new Error('out of responses'); if (r instanceof Error) throw r; return r; }) as typeof fetch;
  return { calls, notes, p: callModel('b', { model: 'm', messages: [] }, provider, new AbortController().signal, { fetchImpl, onRetry: (n) => notes.push(n) }) };
};

test('classify: statuses', () => {
  assert.equal(classify('X', 429, '{"error":{"message":"slow down"}}').kind, 'rate_limit');
  assert.equal(classify('X', 401, '').retryable, false);
  assert.equal(classify('X', 503, '').retryable, true);
  assert.equal(classify('X', 400, '{"error":{"message":"maximum context length is 8192"}}').kind, 'too_long');
  assert.equal(classify('X', 400, '{"error":{"message":"maximum context length"}}').fallback, false);
  assert.equal(classify('X', null, '', Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } })).retryable, false);
  assert.equal(classify('X', null, '', new TypeError('fetch failed')).kind, 'network');
});

test('retries a transient 503 on the same provider, then succeeds', async () => {
  const r = run([fail(503), fail(502), ok()]);
  const a = await r.p;
  assert.equal(a.provider, 'pollinations');
  assert.equal(r.calls.length, 3);
  assert.equal(r.notes.length, 2);
});

test('does not retry an auth error, and reports it plainly', async () => {
  const r = run([fail(401, '{"error":"bad key"}')]);
  await assert.rejects(r.p, (e: any) => e instanceof ModelError && /API key/.test(e.message) && r.calls.length === 1);
});

test('too-long conversations fail at once without fallback', async () => {
  const r = run([fail(400, '{"error":{"message":"context length exceeded"}}')]);
  await assert.rejects(r.p, (e: any) => /too long/.test(e.message) && r.calls.length === 1);
});

test('after 3 failures falls back to another ready provider', async () => {
  const r = run([fail(500), fail(500), fail(500), ok()], 'ollama');
  // ollama is local + not ready here, so the first target fails 3x (connection to localhost refused is mocked as 500)
  const a = await r.p;
  assert.notEqual(a.provider, 'ollama');
  assert.equal(a.switchedFrom, 'Ollama (local)');
});

test('network errors are retried', async () => {
  const r = run([new TypeError('fetch failed'), ok()]);
  await r.p;
  assert.equal(r.calls.length, 2);
});

test('honours Retry-After (capped)', async () => {
  const t = Date.now();
  const r = run([fail(429, '{}', { 'retry-after': '1' }), ok()]);
  await r.p;
  assert.ok(Date.now() - t >= 900, 'waited about 1s');
});

test('stop signal aborts waiting', async () => {
  const ctl = new AbortController();
  const calls: number[] = [];
  const p = callModel('b', { model: 'm' }, 'pollinations', ctl.signal, { fetchImpl: (async () => { calls.push(1); ctl.abort(); return fail(503); }) as any });
  await assert.rejects(p, /Stopped/);
  assert.equal(calls.length, 1);
});

test('all providers down: one clear message naming who was tried', async () => {
  const seq = Array.from({ length: 30 }, () => fail(503));
  const r = run(seq);
  await assert.rejects(r.p, (e: any) => e instanceof ModelError && /trouble|Free cloud/.test(e.message));
});
