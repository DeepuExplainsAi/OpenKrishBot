// End-to-end suite: real built server on a throwaway HOME + a scripted fake OpenAI server. No network, no keys.
// Usage: npm run build && node tests/e2e.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4500 + Math.floor(Math.random() * 400);
const FAKE = PORT + 1000;
const BASE = `http://localhost:${PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'krish-e2e-'));
process.env.E2E_MARK = path.join(home, 'truncated-tool-ran');

// ---- fake OpenAI-compatible model ----
let dropsLeft = 0;
let requests = 0;
let truncLeft = 0;
let dropAfterToolLeft = 0;
const sseChunks = (res, deltas) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const d of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
  res.write('data: [DONE]\n\n'); res.end();
};
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    requests++;
    const msgs = JSON.parse(raw || '{}').messages ?? [];
    const last = msgs[msgs.length - 1] ?? {};
    const text = typeof last.content === 'string' ? last.content : '';
    if (last.role === 'tool' && dropAfterToolLeft-- > 0) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{}}]}\n\n'); return setTimeout(() => res.destroy(), 50); }
    if (last.role === 'tool') return sseChunks(res, [{ content: `RESULT ${text}` }]);
    if (/DROP/.test(text) && dropsLeft-- > 0) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{}}]}\n\n'); return setTimeout(() => res.destroy(), 50); }
    if (/TRUNC/.test(text) && truncLeft-- > 0) { // complete-looking tool call, but the stream ends with no finish_reason/[DONE]
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_t', function: { name: 'terminal', arguments: JSON.stringify({ command: `touch ${process.env.E2E_MARK}` }) } }] } }] })}\n\n`);
      return res.end();
    }
    if (/HANGOPEN/.test(text)) { // finish_reason sent, socket then stays open (some local servers do this)
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'HANG-OK' }, finish_reason: 'stop' }] })}\n\n`);
      return; // never ends
    }
    if (/NOINDEX/.test(text)) { // two parallel tool calls from a relay that omits `index`
      return sseChunks(res, [
        { tool_calls: [{ id: 'c_a', function: { name: 'terminal', arguments: '{"command":"echo AAA' } }] },
        { tool_calls: [{ function: { arguments: '"}' } }] },
        { tool_calls: [{ id: 'c_b', function: { name: 'terminal', arguments: '{"command":"echo BBB"}' } }] },
      ]);
    }
    if (/CUTOFF/.test(text)) { // tool call cut by the token limit: must NOT run
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c_x', function: { name: 'terminal', arguments: `{"command":"touch ${process.env.E2E_MARK}2` } }] }, finish_reason: 'length' }] })}\n\n`);
      return res.end();
    }
    if (/Break this goal into workflow steps/.test(text)) return sseChunks(res, [{ content: '[{"id":"a","bot":"Alpha","prompt":"research {{input}}"},{"id":"b","bot":"Beta","prompt":"write {{a}}","needs":["a"]}]' }]);
    if (/SLOW/.test(text)) { const model = JSON.parse(raw).model; return setTimeout(() => sseChunks(res, [{ content: `SLOW-DONE[${model}]` }]), 1500); }
    if (/QUICK/.test(text)) return sseChunks(res, [{ content: `QUICK-DONE[${JSON.parse(raw).model}]` }]);
    const cmd = text.match(/RUN (.+)$/)?.[1];
    if (cmd) return sseChunks(res, [{ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'terminal', arguments: JSON.stringify({ command: cmd }) } }] }]);
    sseChunks(res, [{ content: `ECHO[${text.replace(/^[\s\S]*?(?=\S)/, '').slice(0, 200)}]` }]);
  });
});
await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));

const srv = spawn('node', ['dist/index.js'], { cwd: path.join(root, 'server'), env: { ...process.env, HOME: home, USERPROFILE: home, PORT: String(PORT), DB_PATH: path.join(home, 'openkrishbot.db'), KRISH_RETRY_BASE_MS: '10' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, true]); console.log(`PASS ${name}`); }
  catch (e) { results.push([name, false]); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = 'condition') => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timed out: ${what}`); await sleep(150); } };

let cookie = '';
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
const rows = async (id) => (await api('GET', `/api/bots/${id}/rows?limit=300`)).rows ?? [];
const assistantTexts = async (id) => (await rows(id)).filter((r) => r.body.type === 'message' && r.body.role === 'assistant').map((r) => r.body.text);
const say = async (id, text) => { await api('POST', `/api/bots/${id}/messages`, { text }); };

try {
  await until(async () => (await fetch(`${BASE}/api/auth/me`).catch(() => null))?.ok, 30000, 'server boot');

  await test('local owner is signed in automatically', async () => {
    const r = await fetch(`${BASE}/api/auth/me`);
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    const j = await r.json();
    ok(j.user && cookie, 'no user/cookie');
  });
  await test('a request with a foreign Host is not signed in', async () => {
    const body = await new Promise((res, rej) => {
      const q = http.request({ host: '127.0.0.1', port: PORT, path: '/api/auth/me', headers: { host: 'evil.example.com' } }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); });
      q.on('error', rej); q.end();
    });
    ok(!JSON.parse(body).user, 'foreign host got signed in');
  });

  let botA, botB;
  await test('create two bots and point them at the fake model', async () => {
    await api('PUT', '/api/krish/providers/custom', { baseUrl: `http://127.0.0.1:${FAKE}`, apiKey: 'test' });
    for (const n of ['Alpha', 'Beta']) {
      const r = await api('POST', '/api/bots', { name: n });
      ok(r.bot?.id, `create ${n}: ${JSON.stringify(r)}`);
      const e = await api('PATCH', `/api/bots/${r.bot.id}/engine`, { provider: 'custom', model: 'fake' });
      ok(e.status === 200, `engine ${e.status}`);
      if (n === 'Alpha') botA = r.bot.id; else botB = r.bot.id;
    }
  });

  await test('chat: bot answers', async () => {
    await say(botA, 'hello there');
    await until(async () => (await assistantTexts(botA)).some((t) => t.includes('ECHO[hello there')), 20000, 'reply');
  });

  await test('messages and model changes during a running job: the job finishes, later messages follow in order on the new model', async () => {
    await say(botB, 'SLOW first job');
    await until(async () => (await api('GET', `/api/bots/${botB}/queue`)).running, 5000, 'job running');
    ok((await api('PATCH', `/api/bots/${botB}/engine`, { provider: 'custom', model: 'fake2' })).status === 200, 'switch model while running');
    await say(botB, 'QUICK second');
    await say(botB, 'QUICK third');
    const q = await api('GET', `/api/bots/${botB}/queue`);
    ok(q.running && q.pending.length === 2, `queue should show 2 waiting, got ${JSON.stringify(q)}`);
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes('QUICK-DONE') && t.includes('fake2')), 20000, 'queued message answered');
    const t = await assistantTexts(botB);
    const at = (needle) => t.findIndex((x) => x.includes(needle));
    ok(at('SLOW-DONE[fake]') >= 0, `first job should finish on the old model: ${JSON.stringify(t)}`);
    ok(at('SLOW-DONE') < at('QUICK-DONE'), 'order');
    await api('PATCH', `/api/bots/${botB}/engine`, { provider: 'custom', model: 'fake' });
  });

  await test('tool use asks for approval; allow runs it and returns the output', async () => {
    await say(botA, 'RUN echo krish-42');
    const card = await until(async () => (await rows(botA)).find((r) => r.body.card === 'approval' && r.body.status !== 'resolved'), 20000, 'approval card');
    ok((await api('POST', `/api/approvals/${card.body.approvalId}`, { decision: 'allow' })).ok, 'approve');
    await until(async () => (await assistantTexts(botA)).some((t) => t.includes('krish-42')), 20000, 'tool result');
  });

  await test('approval with edited args: the edited command runs, not the original', async () => {
    await say(botA, 'RUN echo original-11');
    const card = await until(async () => (await rows(botA)).filter((r) => r.body.card === 'approval' && r.body.status === 'pending').pop(), 20000, 'approval card');
    ok((await api('POST', `/api/approvals/${card.body.approvalId}`, { decision: 'allow', edit: { command: 'echo edited-22', nope: 'x' } })).ok, 'approve with edit');
    await until(async () => (await assistantTexts(botA)).some((t) => t.includes('edited-22')), 20000, 'edited output');
    ok(!(await assistantTexts(botA)).some((t) => t.includes('RESULT') && t.includes('original-11') && !t.includes('ECHO')), 'original ran');
  });

  await test('reading vault.key asks even in follow mode', async () => {
    ok((await api('PUT', '/api/audit/danger-mode', { mode: 'follow' })).status === 200, 'set follow');
    try {
      await say(botA, 'RUN cat ~/.openkrishbot/vault.key');
      const card = await until(async () => (await rows(botA)).find((r) => r.body.card === 'approval' && r.body.status === 'pending' && /vault\.key/.test(JSON.stringify(r.body))), 20000, 'key card');
      await api('POST', `/api/approvals/${card.body.approvalId}`, { decision: 'deny' });
    } finally { await api('PUT', '/api/audit/danger-mode', { mode: 'ask' }); }
  });

  await test('dangerous command asks; deny is audited as declined and nothing runs', async () => {
    const marker = path.join(home, 'danger-marker');
    await say(botA, `RUN rm -rf / --no-preserve-root; touch ${marker}`);
    const card = await until(async () => (await rows(botA)).find((r) => r.body.card === 'approval' && r.body.status !== 'resolved' && /rm -rf/.test(JSON.stringify(r.body))), 20000, 'danger card');
    await api('POST', `/api/approvals/${card.body.approvalId}`, { decision: 'deny' });
    await until(async () => ((await api('GET', '/api/audit')).entries ?? []).some((e) => e.status === 'declined' && /rm -rf/.test(JSON.stringify(e))), 20000, 'declined in audit');
    ok(!fs.existsSync(marker), 'denied command ran anyway');
  });

  await test('autonomous mode: normal tools run without asking, risky ones still ask', async () => {
    ok((await api('PUT', '/api/audit/danger-mode', { mode: 'auto' })).status === 200, 'set auto');
    try {
      const before = (await rows(botA)).filter((r) => r.body.card === 'approval').length;
      await say(botA, 'RUN echo auto-77');
      await until(async () => (await assistantTexts(botA)).some((t) => t.includes('auto-77')), 20000, 'ran without a card');
      ok((await rows(botA)).filter((r) => r.body.card === 'approval').length === before, 'a card appeared in auto mode');
      const marker = path.join(home, 'auto-marker');
      await say(botA, `RUN chmod -R 777 /tmp/no-such-dir-auto; touch ${marker}`);
      const card = await until(async () => (await rows(botA)).find((r) => r.body.card === 'approval' && r.body.status === 'pending' && /chmod -R/.test(JSON.stringify(r.body))), 20000, 'risky card');
      await api('POST', `/api/approvals/${card.body.approvalId}`, { decision: 'deny' });
      ok(!fs.existsSync(marker), 'denied risky command ran');
    } finally { await api('PUT', '/api/audit/danger-mode', { mode: 'ask' }); }
  });

  await test('mid-stream connection drop is retried invisibly', async () => {
    dropsLeft = 1;
    await say(botB, 'DROP please');
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes('ECHO[DROP please')), 25000, 'answer after drop');
  });

  await test('truncated stream never runs its tool call', async () => {
    truncLeft = 5;
    await say(botB, 'TRUNC now');
    await until(async () => (await rows(botB)).some((r) => /TRUNC|connection|dropped|ended/i.test(JSON.stringify(r.body)) && (r.body.type === 'notice' || r.body.tone === 'error')), 25000, 'interruption surfaced');
    truncLeft = 0;
    ok(!fs.existsSync(process.env.E2E_MARK), 'tool from an unfinished stream was executed');
  });

  await test('a drop on the step after a tool call runs the tool exactly once', async () => {
    const marker = path.join(home, 'once-marker');
    fs.writeFileSync(marker, '');
    dropAfterToolLeft = 1;
    await say(botA, `RUN echo x >> ${marker}`);
    const card = await until(async () => (await rows(botA)).filter((r) => r.body.card === 'approval' && r.body.status !== 'resolved').pop(), 20000, 'approval');
    await api('POST', `/api/approvals/${card.body.approvalId}`, { decision: 'allow' });
    await until(async () => (await assistantTexts(botA)).filter((t) => t.startsWith('RESULT')).length >= 2, 25000, 'final answer after drop');
    ok(fs.readFileSync(marker, 'utf8').trim().split('\n').length === 1, 'tool ran more than once');
  });

  await test('daily token budget blocks without calling the model; removing it restores', async () => {
    ok((await api('PUT', `/api/bots/${botB}/budget`, { dailyTokens: 1 })).status === 200, 'set budget');
    const before = requests;
    await say(botB, 'over the cap');
    await until(async () => (await rows(botB)).some((r) => /daily limit/i.test(JSON.stringify(r.body))), 20000, 'budget notice');
    ok(requests === before, 'model was called despite the cap');
    await api('PUT', `/api/bots/${botB}/budget`, { dailyTokens: null });
    await say(botB, 'back again');
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes('ECHO[back again')), 20000, 'reply after budget removed');
  });

  await test('stream that stays open after finish_reason still completes', async () => {
    await say(botA, 'HANGOPEN please');
    await until(async () => (await assistantTexts(botA)).some((t) => t.includes('HANG-OK')), 15000, 'reply despite open socket');
    await until(async () => !(await api('GET', '/api/bots')).live?.find((l) => l.botId === botA)?.isRunning, 15000, 'turn ends');
  });

  await test('parallel tool calls without index stay separate', async () => {
    await say(botA, 'NOINDEX go');
    // approve whatever is pending (earlier tests may already have set "always allow"), until both calls are done
    const cmds = async () => (await rows(botA)).filter((r) => r.body.type === 'tool-call' && (r.body.callId === 'c_a' || r.body.callId === 'c_b')).map((r) => `${r.body.callId}=${r.body.args?.command}`);
    await until(async () => {
      for (const r of (await rows(botA)).filter((x) => x.body.card === 'approval' && x.body.status === 'pending')) await api('POST', `/api/approvals/${r.body.approvalId}`, { decision: 'allow' });
      return (await cmds()).length >= 2;
    }, 25000, 'both tool calls');
    const got = await cmds();
    ok(got.includes('c_a=echo AAA') && got.includes('c_b=echo BBB'), `calls were merged or garbled: ${got}`);
  });

  await test('tool call cut by length is refused and never runs', async () => {
    await say(botA, 'CUTOFF now');
    await until(async () => (await rows(botA)).some((r) => /ran out of room/.test(JSON.stringify(r.body))), 20000, 'friendly error');
    ok(!fs.existsSync(process.env.E2E_MARK + '2'), 'cut-off tool call ran');
  });

  await test('bad input: malformed approval/message/bot bodies get 400/413, not a crash or a decision', async () => {
    ok((await api('POST', '/api/approvals/nope', { decision: 'maybe' })).status === 400, 'odd decision accepted');
    ok((await api('POST', '/api/approvals/nope', {})).status === 400, 'missing decision accepted');
    ok((await api('POST', `/api/bots/${botA}/messages`, { text: 5 })).status === 400, 'non-string text accepted');
    ok((await api('POST', `/api/bots/${botA}/messages`, { text: 'x'.repeat(60001) })).status === 413, 'huge text accepted');
    ok((await api('POST', '/api/bots', undefined)).status === 400, 'empty bot body accepted');
    ok((await api('GET', '/api/health')).ok, 'server down after bad input');
  });

  await test('workflow: fork/join runs and merges', async () => {
    const f = await api('PUT', '/api/flows', { name: 'Fork', steps: [
      { id: 'a', bot: 'Alpha', prompt: 'facts on {{input}}' },
      { id: 'b', bot: 'Beta', prompt: 'angles on {{input}}' },
      { id: 'm', bot: 'Alpha', prompt: 'merge {{a}} AND {{b}}', needs: ['a', 'b'] },
    ] });
    ok(f.flow?.id, JSON.stringify(f));
    const run = await api('POST', `/api/flows/${f.flow.id}/run`, { input: 'cats' });
    const done = await until(async () => { const r = (await api('GET', `/api/flows/runs/${run.runId}`)).run; return r.status !== 'running' ? r : null; }, 60000, 'flow finish');
    ok(done.status === 'done', `status ${done.status} ${JSON.stringify(done.results)}`);
    ok(/cats/.test(done.results.m.output) && /facts/.test(done.results.m.output), 'merge lacks inputs');
  });

  await test('workflow: "ask me first" step waits; no fails it and skips the rest; continue + yes finishes it', async () => {
    const f = (await api('PUT', '/api/flows', { name: 'Gated', steps: [
      { id: 'a', bot: 'Alpha', prompt: 'draft {{input}}' },
      { id: 'g', bot: 'Beta', prompt: 'send {{a}}', needs: ['a'], gate: true },
      { id: 'z', bot: 'Alpha', prompt: 'report {{g}}', needs: ['g'] },
    ] })).flow;
    ok(f?.steps[1].gate === true, 'gate not saved');
    const card = async (n) => until(async () => (await rows(botB)).filter((r) => r.body.card === 'approval' && /flow_step/.test(r.body.tool ?? '') && r.body.status === 'pending')[n - 1] ?? null, 30000, 'gate card');
    const run = await api('POST', `/api/flows/${f.id}/run`, { input: 'mail' });
    const c1 = await card(1);
    const mid = (await api('GET', `/api/flows/runs/${run.runId}`)).run;
    ok(mid.status === 'running' && mid.results.a.status === 'done' && mid.results.g.status === 'running', `should be waiting: ${JSON.stringify(mid.results)}`);
    await api('POST', `/api/approvals/${c1.body.approvalId}`, { decision: 'deny' });
    const bad = await until(async () => { const r = (await api('GET', `/api/flows/runs/${run.runId}`)).run; return r.status !== 'running' ? r : null; }, 30000, 'run end');
    ok(bad.status === 'failed' && bad.results.g.error === 'Not approved.' && bad.results.z.status === 'skipped', JSON.stringify(bad.results));
    const again = await api('POST', `/api/flows/runs/${run.runId}/resume`, {});
    ok(again.runId, JSON.stringify(again));
    const c2 = await until(async () => (await rows(botB)).filter((r) => r.body.card === 'approval' && /flow_step/.test(r.body.tool ?? '') && r.body.status === 'pending').pop() ?? null, 30000, 'second gate card');
    await api('POST', `/api/approvals/${c2.body.approvalId}`, { decision: 'allow' });
    const fin = await until(async () => { const r = (await api('GET', `/api/flows/runs/${again.runId}`)).run; return r.status !== 'running' ? r : null; }, 60000, 'resumed run end');
    ok(fin.status === 'done' && fin.results.a.status === 'done' && fin.results.z.status === 'done', JSON.stringify(fin.results));
    await api('DELETE', `/api/flows/${f.id}`);
  });

  await test('workflow: Plan with AI drafts steps from a goal', async () => {
    const p = await api('POST', '/api/flows/plan', { goal: 'launch a blog', bot: 'Alpha' });
    ok(p.steps?.length === 2 && p.steps[1].needs[0] === 'a' && p.steps[1].bot === 'Beta', JSON.stringify(p));
    ok((await api('POST', '/api/flows/plan', { goal: ' ' })).status === 400, 'empty goal accepted');
  });

  await test('skills: import SKILL.md, listed as custom, enabled/removed; built-ins cannot be removed', async () => {
    const r = await api('POST', '/api/skill-library/import', { markdown: '---\nname: Pirate Talk\ntriggers: arr matey\n---\nSpeak like a pirate.' });
    ok(r.id === 'pirate-talk', JSON.stringify(r));
    const l = (await api('GET', '/api/skill-library')).skills;
    ok(l.find((x) => x.id === 'pirate-talk')?.custom === true, 'not listed as custom');
    ok((await api('POST', '/api/skill-library/import', { url: 'https://example.com/x' })).status === 400, 'non-GitHub url accepted');
    ok((await api('DELETE', '/api/skill-library/daily-brief')).status === 404, 'built-in removed');
    ok((await api('DELETE', '/api/skill-library/pirate-talk')).ok, 'remove failed');
  });

  await test('workflow: cron validated; bad schedule refused, good one saved', async () => {
    const steps = [{ id: 'a', bot: 'Alpha', prompt: 'x' }];
    ok((await api('PUT', '/api/flows', { name: 'Bad', steps, schedule: 'nonsense' })).status === 400, 'bad cron accepted');
    const g = await api('PUT', '/api/flows', { name: 'Good', steps, schedule: '0 9 * * 1-5' });
    ok(g.flow?.schedule === '0 9 * * 1-5', 'schedule not saved');
  });

  await test('projects: create, file, assign bot, prompt, delete frees bot', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Launch', instructions: 'Reply in Hindi.' })).project;
    ok(p?.id, 'project not created');
    ok((await api('POST', `/api/projects/${p.id}/files`, { name: 'brand.md', content: 'Tone: friendly' })).project.files.length === 1, 'file not added');
    ok((await api('PUT', '/api/projects/assign', { botId: botA, projectId: p.id })).ok, 'assign failed');
    ok((await api('GET', '/api/projects')).projects[0].botIds.includes(botA), 'bot not listed in project');
    ok((await api('PUT', '/api/projects/assign', { botId: 'nobody', projectId: p.id })).status === 400, 'unknown bot accepted');
    ok((await api('DELETE', `/api/projects/${p.id}`)).ok, 'delete failed');
    ok((await api('GET', '/api/projects')).projects.length === 0, 'project still listed');
  });

  await test('vault + company export/import over HTTP: value never comes back; bot carries projectId', async () => {
    const put = await api('PUT', '/api/vault', { name: 'shop', value: 'SUPER-SECRET-VALUE-1', origin: 'https://api.example.com', auth: 'bearer' });
    ok(put.item?.name === 'shop' && !JSON.stringify(put).includes('SUPER-SECRET'), 'vault save leaked or failed');
    ok(!JSON.stringify(await api('GET', '/api/vault')).includes('SUPER-SECRET'), 'vault list leaked the value');
    ok((await api('PUT', '/api/vault', { name: 'x', value: 'v', origin: 'http://evil.com' })).status === 400, 'plain http origin accepted');
    const p = (await api('POST', '/api/projects', { name: 'Shop Co', instructions: 'Sell.' })).project;
    await api('PUT', '/api/projects/assign', { botId: botA, projectId: p.id });
    const bots = (await api('GET', '/api/bots')).bots;
    ok(bots.find((b) => b.id === botA).projectId === p.id, 'bot has no projectId');
    const ex = await fetch(`${BASE}/api/projects/${p.id}/export`, { headers: { cookie } });
    ok(ex.ok && /attachment/.test(ex.headers.get('content-disposition') ?? ''), 'export is not a download');
    const data = await ex.json();
    ok(data.format === 'openkrishbot-company-v1' && data.bots.length === 1 && !JSON.stringify(data).includes('SUPER-SECRET'), 'export wrong');
    const imp = (await api('POST', '/api/projects/import', data)).project;
    ok(imp?.name === 'Shop Co (imported)' && imp.botIds.length === 1, 'import failed');
    ok((await api('POST', '/api/projects/import', { x: 1 })).status === 400, 'bad file accepted');
    // the model echoes a secret it was told, and runs a tool with it: neither may reach the transcript or audit log
    await say(botB, 'my key is SUPER-SECRET-VALUE-1');
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes('my key is')), 20000, 'echo');
    ok(!(await assistantTexts(botB)).some((t) => t.includes('SUPER-SECRET')), 'secret in assistant text');
    ok((await assistantTexts(botB)).some((t) => t.includes('[vault secret hidden]')), 'secret not replaced');
    await say(botB, 'RUN echo SUPER-SECRET-VALUE-1');
    const ap = await until(async () => (await rows(botB)).find((r) => r.body.card === 'approval' && r.body.status === 'pending' && /terminal/.test(r.body.tool ?? '')), 20000, 'approval');
    await api('POST', `/api/approvals/${ap.body.approvalId}`, { decision: 'allow' });
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes('RESULT')), 20000, 'tool result');
    const leaks = (await rows(botB)).filter((r) => !(r.body.role === 'user') && JSON.stringify(r.body).includes('SUPER-SECRET')).map((r) => `${r.kind}/${r.body.role ?? r.body.name ?? r.body.type}`);
    ok(!leaks.length, `secret in transcript rows: ${leaks.join(', ')}`);
    ok(!JSON.stringify(await api('GET', '/api/audit')).includes('SUPER-SECRET'), 'secret in audit');
    ok((await api('DELETE', '/api/vault/shop')).ok, 'vault delete failed');
    for (const id of [p.id, imp.id]) await api('DELETE', `/api/projects/${id}`);
  });

  await test('goals: tree, owner, issue link, progress, cycle refused, delete lifts children', async () => {
    const m = (await api('POST', '/api/goals', { title: 'Mission', ownerBotId: botA })).goal;
    ok(m?.id && m.level === 'mission', 'mission not created');
    const p = (await api('POST', '/api/goals', { title: 'Part', parentId: m.id })).goal;
    ok(p?.parentId === m.id, 'child not under parent');
    ok((await api('PATCH', `/api/goals/${m.id}`, { parentId: p.id })).status === 400, 'cycle accepted');
    ok((await api('POST', '/api/goals', { title: 'x', ownerBotId: 'nobody' })).status === 400, 'unknown owner accepted');
    const i = await api('POST', '/api/issues', { title: 'Goal work', goalId: p.id });
    ok(i.issue?.goalId === p.id, 'issue not linked at create');
    ok((await api('POST', '/api/issues', { title: 'bad', goalId: 'goal_nope' })).status === 400, 'unknown goal accepted on issue');
    const before = (await api('GET', '/api/goals')).goals.find((g) => g.id === m.id);
    ok(before.total === 1 && before.done === 0, `rollup before: ${JSON.stringify(before)}`);
    await api('PATCH', `/api/issues/${i.issue.id}`, { status: 'cancelled' });
    ok((await api('GET', '/api/goals')).goals.find((g) => g.id === m.id).total === 0, 'cancelled issue still counted');
    ok((await api('DELETE', `/api/goals/${m.id}`)).ok, 'delete failed');
    ok((await api('GET', '/api/goals')).goals.find((g) => g.id === p.id).parentId === null, 'child not lifted');
  });

  await test('price: set per bot, shows in budget info, bad price refused, cleared with zeros', async () => {
    ok((await api('PUT', `/api/bots/${botA}/price`, { inPerM: -1, outPerM: 1 })).status === 400, 'negative price accepted');
    const r = await api('PUT', `/api/bots/${botA}/price`, { inPerM: 1, outPerM: 2 });
    ok(r.price?.inPerM === 1 && typeof r.today?.costUsd === 'number', JSON.stringify(r));
    const c = await api('PUT', `/api/bots/${botA}/price`, { inPerM: 0, outPerM: 0 });
    ok(c.price === null && c.today.costUsd === 0, 'not cleared');
  });

  await test('issues: assign wakes bot, comment reaches it, state visible', async () => {
    const i = await api('POST', '/api/issues', { title: 'Write report', assigneeBotId: botB });
    ok(i.issue?.id, JSON.stringify(i));
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes(i.issue.id)), 20000, 'assignee woken');
    const c = await api('POST', `/api/issues/${i.issue.id}/comments`, { text: 'use staging' });
    ok(c.comment?.id, 'comment failed');
    await until(async () => (await assistantTexts(botB)).some((t) => t.includes('use staging')), 20000, 'comment woke bot');
    ok((await api('GET', `/api/issues/${i.issue.id}/comments`)).comments.length === 1, 'comment list');
    ok((await api('GET', '/api/issues')).issues.some((x) => x.id === i.issue.id), 'issue missing');
  });

  await test('skills, usage, providers and audit endpoints respond', async () => {
    ok((await api('GET', '/api/skill-library')).status === 200, 'skills');
    ok((await api('GET', '/api/usage')).usage, 'usage');
    ok((await api('GET', '/api/krish/providers')).providers?.length > 5, 'providers');
    ok((await api('GET', '/api/audit')).status === 200, 'audit');
  });

  await test('telegram: malformed token is refused with 400; logs do not leak provider config', async () => {
    const r = await api('PUT', '/api/telegram/token', { token: 'not-a-token' });
    ok(r.status === 400, `expected 400, got ${r.status}`);
    ok(!/apiKey/.test(log), 'log leaks provider config');
  });
} finally {
  srv.kill(); fake.close();
  fs.rmSync(home, { recursive: true, force: true });
}

const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('Server log tail:\n' + log.split('\n').slice(-15).join('\n'));
process.exit(failed.length ? 1 : 0);
