import test from 'node:test';
import assert from 'node:assert/strict';
const { validate, fill, runFlow } = await import('../src/flow.js');

const S = (id: string, needs: string[] = [], extra = {}) => ({ id, bot: 'b', prompt: `do ${id}`, needs, ...extra });

test('validate: bad ids, unknown needs, cycles, empty', () => {
  assert.ok(validate([]));
  assert.ok(validate([S('A')]));
  assert.ok(validate([S('a'), S('a')]));
  assert.match(validate([S('a', ['zzz'])])!, /does not exist/);
  assert.match(validate([S('a', ['b']), S('b', ['a'])])!, /loop/);
  assert.equal(validate([S('a'), S('b', ['a'])]), null);
});

test('fill: input and finished outputs, unknown left as is', () => {
  const r = { a: { status: 'done', output: 'AA', attempts: 1 }, b: { status: 'failed', attempts: 1 } } as any;
  assert.equal(fill('x {{input}} {{a}} {{b}} {{c}}', 'IN', r), 'x IN AA {{b}} {{c}}');
});

test('runs in dependency order, passes outputs, independent steps in parallel', async () => {
  let live = 0, peak = 0;
  const order: string[] = [];
  const res = await runFlow([S('a'), S('b'), S('c', ['a', 'b'], {})].map((s) => (s.id === 'c' ? { ...s, prompt: 'merge {{a}}+{{b}} for {{input}}' } : s)), {
    input: 'goal',
    exec: async (s, p) => { live++; peak = Math.max(peak, live); order.push(s.id); await new Promise((r) => setTimeout(r, 15)); live--; return s.id === 'c' ? p : s.id.toUpperCase(); },
  });
  assert.equal(res.status, 'done');
  assert.equal(peak, 2);
  assert.equal(order[2], 'c');
  assert.equal(res.results.c.output, 'merge A+B for goal');
});

test('failure skips downstream, keeps independent branch, retries first', async () => {
  let tries = 0;
  const res = await runFlow([S('a', [], { retries: 1 }), S('b', ['a']), S('c')], {
    input: '',
    exec: async (s) => { if (s.id === 'a') { tries++; throw new Error('boom'); } return 'ok'; },
  });
  assert.equal(res.status, 'failed');
  assert.equal(tries, 2);
  assert.equal(res.results.a.attempts, 2);
  assert.equal(res.results.b.status, 'skipped');
  assert.equal(res.results.c.status, 'done');
});

test('a retry that works ends done', async () => {
  let n = 0;
  const res = await runFlow([S('a', [], { retries: 2 })], { input: '', exec: async () => { if (++n < 3) throw new Error('x'); return 'fine'; } });
  assert.equal(res.status, 'done');
  assert.equal(res.results.a.attempts, 3);
});

test('stop signal skips what has not started', async () => {
  const ctl = new AbortController();
  const res = await runFlow([S('a'), S('b', ['a'])], { input: '', signal: ctl.signal, exec: async () => { ctl.abort(); return 'x'; } });
  assert.equal(res.status, 'stopped');
  assert.equal(res.results.b.status, 'skipped');
});

test('concurrency cap', async () => {
  let live = 0, peak = 0;
  await runFlow([S('a'), S('b'), S('c'), S('d')], { input: '', concurrency: 2, exec: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; return ''; } });
  assert.equal(peak, 2);
});

test('a hung step times out instead of leaving the run open', async () => {
  const res = await runFlow([S('a', [], { retries: 0 }), S('b', ['a'])], { input: '', stepTimeoutMs: 50, exec: () => new Promise(() => {}) });
  assert.equal(res.status, 'failed');
  assert.match(res.results.a.error!, /took longer/);
  assert.equal(res.results.b.status, 'skipped');
});

test('retries wait between attempts (backoff)', async () => {
  const stamps: number[] = [];
  await runFlow([S('a', [], { retries: 2 })], { input: '', retryBaseMs: 40, exec: async () => { stamps.push(Date.now()); throw new Error('x'); } });
  assert.equal(stamps.length, 3);
  assert.ok(stamps[1] - stamps[0] >= 35 && stamps[2] - stamps[1] >= 70, `gaps ${stamps[1] - stamps[0]}, ${stamps[2] - stamps[1]}`);
});
