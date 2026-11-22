import { Hono } from 'hono';
import { scrubVault } from '../vault.js';
import { takeScreenshot } from '../screen/tools.js';
import fs from 'node:fs';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser, type AuthVars } from '../lib/auth.js';
import { engineKey } from '../engine.js';
import { callModel } from './resilient.js';
import { skillsPrompt } from '../skill-library.js';
import { estimateTokens, overBudget, recordUsage } from '../usage.js';
import { SUMMARY_PROMPT, compactHistory, recentWindow, type Msg } from './compact.js';
import { loopNudge } from '../plan.js';
import { DEFAULT_PROVIDER, PRESETS, hasKey, liveModels, resolve, saveProvider } from './providers.js';
import { botHome, localToolMap, LOCAL_TOOLS } from './tools.js';
import { TOOLS, policyFor, toolMap } from '../agent/tools.js';
import { callTool as callHqTool, listTools as listHqTools } from '../mcp.js';
import { claimToolRow, noteToolOutcome, requestApproval } from '../agent/loop.js';
import { audit, autoSkips, dangerReason, getDangerMode, redact, riskyReason } from '../danger.js';
import { runCli, cliFound, forgetCliLookups } from './cli.js';
import { extraTools, callExtraTool } from './mcp-client.js';

/**
 * The OpenKrishBot engine: an agent loop that lives inside this server. It speaks the same event stream
 * as a Hermes gateway's /v1/responses, so the chat, approvals and activity UI work unchanged, with no
 * second process, no cloud and no account. Models come from any OpenAI-compatible endpoint.
 */

export const krishApi = new Hono();

krishApi.use('/v1/*', async (c, next) => {
  if ((c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '') !== engineKey()) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

const SEES_IMAGES = /gpt-4o|gpt-4\.1|gpt-5|gpt-6|claude|gemini|llava|vision|-vl|pixtral|llama-?4|gemma-?3|grok|luna|astra/i;
const threads = new Map<string, Msg[]>();
const DECLINED = 'The user declined this action. Do not retry it. Find another way, or tell the user what you could not do.';
const SKIPPED = 'Skipped: the user did not approve this in time. Do not retry unless they ask.';
const MAX_STEPS = 40;
const MAX_HISTORY = 60;

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...(data as object) })}\n\n`;

/** Tools the model sees: local tools, the app's tools, and any MCP connectors, in OpenAI function format. */
async function toolsFor(botId: string) {
  const own = new Set(LOCAL_TOOLS.map((t) => t.name));
  const list: { type: 'function'; function: { name: string; description: string; parameters: any } }[] = LOCAL_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  for (const t of await listHqTools(botId)) if (!own.has(t.name)) list.push({ type: 'function', function: { name: `mcp_hq_${t.name}`, description: t.description, parameters: t.inputSchema } });
  for (const t of await extraTools(botId)) list.push({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } });
  return list;
}

const IDLE_MS = 120_000;   // no bytes for this long = the model is stuck (slow local models stream for minutes, so only idle counts)
const GRACE_MS = 1_500;    // after finish_reason, wait briefly for a trailing usage chunk, then stop (some servers keep the socket open)

/** Yields stream chunks; throws if the body ends without [DONE] or a finish_reason, goes idle, or the provider sends an error payload. */
async function* deltas(res: Response, out: { finish?: string } = {}) {
  const dec = new TextDecoder();
  const it = (res.body as any as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  let buf = '';
  let complete = false;
  try {
    for (;;) {
      const wait = complete ? GRACE_MS : IDLE_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([it.next(), new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), wait); })]);
      clearTimeout(timer);
      if (next === 'timeout') { if (complete) return; throw new Error('stream went idle'); }
      if (next.done) break;
      buf += dec.decode(next.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') return void (complete = true);
        if (!raw) continue;
        let j: any;
        try { j = JSON.parse(raw); } catch { continue; }
        if (j.error) throw new Error(String(j.error.message ?? j.error));
        const fin = j.choices?.find((ch: any) => ch.finish_reason)?.finish_reason;
        if (fin) { complete = true; out.finish = fin; }
        yield j;
      }
    }
  } finally { void it.return?.(); }
  if (!complete) throw new Error('stream ended early');
}

krishApi.post('/v1/responses', async (c) => {
  const b = await c.req.json<any>();
  const botId = String(b.conversation ?? '').replace(/^hq-/, '').replace(/-g\d+$/, '');
  const convo = String(b.conversation ?? botId);
  const history = threads.get(convo) ?? [];
  history.push({ role: 'user', content: String(b.input ?? '') });
  const bot = db.prepare('SELECT * FROM bots WHERE id=?').get(botId) as any;
  const { preset } = resolve(bot?.provider);
  const model = (bot?.model || preset.models[0] || 'openai-fast') as string;
  const effort = b.model_options?.reasoning_effort;
  const home = botHome(botId);
  fs.mkdirSync(`${home}/work`, { recursive: true });
  const memory = ['MEMORY.md', 'USER.md'].map((f) => { try { return fs.readFileSync(`${home}/memories/${f}`, 'utf8').replace(/\n§\n/g, '\n- '); } catch { return ''; } }).filter(Boolean).join('\n');
  const system = `${b.instructions ?? ''}\n\n## Your computer\nYou run on the user's own computer, with a shell, files, Python and the web. Your workspace folder is ${home}/work. Be careful with anything destructive.${memory ? `\n\n## What you remember\n- ${memory}` : ''}${skillsPrompt(String(b.input ?? ''))}`;

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(sse(event, data)));
      let n = 0;
      try {
        if (preset.cli) {
          // subscription model: the CLI is its own agent and runs its own tools
          const answer = await runCli(preset, system, history, c.req.raw.signal).catch((e) => { throw Object.assign(e, { name: 'ModelError' }); });
          history.push({ role: 'assistant', content: answer });
          recordUsage(botId, estimateTokens(system.length + JSON.stringify(history).length), estimateTokens(answer.length));
          send('response.output_item.done', { item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] } });
          send('response.completed', { response: { status: 'completed' } });
          return;
        }
        const tools = await toolsFor(botId);
        const summarize = async (transcript: string) => {
          const att = await callModel(botId, { model, stream: false, messages: [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: transcript }] }, bot?.provider, c.req.raw.signal);
          return String((await att.res.json() as any)?.choices?.[0]?.message?.content ?? '');
        };
        for (let step = 0; step < MAX_STEPS; step++) {
          if (await compactHistory(history, system.length, summarize)) send('krish.notice', { text: 'Long chat: older messages were summarised to keep going.' });
          const stop = overBudget(botId);
          if (stop) throw Object.assign(new Error(stop), { name: 'ModelError' });
          let text = '';
          let emitted = false;
          let reported: { prompt_tokens?: number; completion_tokens?: number } | null = null;
          let calls: Record<number, { id: string; name: string; args: string }> = {};
          for (let tryNo = 0; ; tryNo++) {
            text = ''; calls = {}; emitted = false;
            const byId = new Map<string, number>();
            const att = await callModel(botId, { model, stream: true, messages: [{ role: 'system', content: system }, ...recentWindow(history, MAX_HISTORY)], ...(tools.length ? { tools, tool_choice: 'auto' } : {}), ...(effort && /gpt-5|o\d|gpt-oss/.test(model) ? { reasoning_effort: effort } : {}) }, bot?.provider, c.req.raw.signal, { onRetry: (note) => send('krish.notice', { text: note }) });
            if (att.switchedFrom) { send('krish.notice', { text: `${att.switchedFrom} failed, so ${att.providerName} answered.` }); }
            const res = att.res;
            try {
              const fin: { finish?: string } = {};
              for await (const j of deltas(res, fin)) {
                if (j.usage) reported = j.usage;
                const d = j.choices?.[0]?.delta;
                if (!d) continue;
                const r = d.reasoning ?? d.reasoning_content;
                if (r) { emitted = true; send('response.reasoning_summary_text.delta', { delta: r }); }
                if (d.content) { text += d.content; send('response.output_text.delta', { delta: d.content }); }
                for (const tc of d.tool_calls ?? []) {
                  // slot by index; relays that omit it: a new id opens a new slot, no id continues the last one
                  const slot = tc.index ?? (tc.id ? (byId.get(tc.id) ?? byId.set(tc.id, Object.keys(calls).length).get(tc.id)!) : Math.max(0, Object.keys(calls).length - 1));
                  const k = calls[slot] ??= { id: tc.id ?? `call_${Date.now()}_${n++}`, name: '', args: '' };
                  if (tc.id) { k.id = tc.id; byId.set(tc.id, slot); }
                  if (tc.function?.name) k.name += tc.function.name;
                  if (tc.function?.arguments) k.args += tc.function.arguments;
                }
              }
              if (fin.finish && fin.finish !== 'stop' && fin.finish !== 'tool_calls' && Object.keys(calls).length) {
                throw Object.assign(new Error(fin.finish === 'length' ? 'The model ran out of room mid tool call, so nothing was run. Try a shorter request.' : `The model stopped (${fin.finish}) before finishing a tool call, so nothing was run.`), { name: 'ModelError', final: true });
              }
              break;
            } catch (e: any) {
              if (c.req.raw.signal.aborted || e?.final) throw e;
              // nothing shown yet: a replay is invisible, so try once more. Otherwise keep what arrived and say so.
              if (!emitted && !text && !Object.keys(calls).length && tryNo < 1) { send('krish.notice', { text: 'The model connection dropped, trying again…' }); await new Promise((r) => setTimeout(r, 1500)); continue; }
              if ((text || emitted) && !Object.keys(calls).length) { send('krish.notice', { text: 'The model connection dropped before it finished; this answer may be cut short.' }); break; }
              recordUsage(botId, estimateTokens(JSON.stringify(recentWindow(history, MAX_HISTORY)).length + system.length), 0); // the provider still counted this prompt
              throw Object.assign(new Error('The model connection dropped mid-answer. Please send your message again.'), { name: 'ModelError' });
            }
          }
          const list = Object.values(calls).filter((k) => k.name);
          recordUsage(botId, reported?.prompt_tokens ?? estimateTokens(JSON.stringify(recentWindow(history, MAX_HISTORY)).length + system.length), reported?.completion_tokens ?? estimateTokens(text.length + list.reduce((n, k) => n + k.args.length, 0)));
          history.push({ role: 'assistant', content: text || null, ...(list.length ? { tool_calls: list.map((k) => ({ id: k.id, type: 'function', function: { name: k.name, arguments: k.args || '{}' } })) } : {}) });
          if (text) send('response.output_item.done', { item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
          if (!list.length) break;
          for (const k of list) {
            send('response.output_item.added', { item: { type: 'function_call', call_id: k.id, name: k.name, arguments: k.args || '{}' } });
            const out = await runTool(botId, k.name, k.args, home);
            history.push({ role: 'tool', tool_call_id: k.id, content: out });
            const shot = takeScreenshot(botId);
            if (shot && SEES_IMAGES.test(model)) history.push({ role: 'user', content: [{ type: 'text', text: 'Screenshot of the page:' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } }] });
            send('response.output_item.done', { item: { type: 'function_call_output', call_id: k.id, output: out } });
          }
        }
        send('response.completed', { response: { status: 'completed' } });
      } catch (e: any) {
        if (!c.req.raw.signal.aborted) send('response.failed', { response: { error: { message: String(e?.message ?? e), friendly: e?.name === 'ModelError' } } });
      } finally {
        threads.set(convo, recentWindow(history, MAX_HISTORY * 2));
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
});

const recentCalls = new Map<string, string[]>();

async function runTool(botId: string, name: string, rawArgs: string, home: string): Promise<string> {
  const owner = (db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as any)?.user_id as string | undefined;
  const raw = await runToolOnce(botId, name, rawArgs, home);
  const out = redact(owner ? scrubVault(owner, raw) : raw);
  let a: any; try { a = JSON.parse(rawArgs || '{}'); } catch { a = rawArgs; }
  audit({ bot: botId, tool: name, status: out === DECLINED || out === SKIPPED ? 'declined' : /^\s*\{"error"/.test(out) ? 'error' : 'done', danger: dangerReason(name, a), args: owner ? scrubVault(owner, JSON.stringify(a ?? {})) : a });
  const nudge = loopNudge(recentCalls.get(botId) ?? (recentCalls.set(botId, []), recentCalls.get(botId)!), `${name}:${rawArgs}`);
  return nudge ? `${out}\n\n${nudge}` : out;
}

async function runToolOnce(botId: string, name: string, rawArgs: string, home: string): Promise<string> {
  let args: any = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return JSON.stringify({ error: 'The tool arguments were not valid JSON. Try again.' }); }
  const local = localToolMap.get(name);
  try {
    if (local) {
      // Local tools go through the same approval cards as every other write.
      const userId = (db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as any).user_id as string;
      const seq = await claimToolRow(botId, name);
      const danger = riskyReason(name, args);
      const forceAsk = !!danger && (getDangerMode() !== 'follow' || /stored keys/.test(danger));
      if ((local.ask && !autoSkips(name, args)) || forceAsk) {
        const key = `local:${name}`;
        const mode = (db.prepare('SELECT mode FROM policies WHERE user_id=? AND tool=?').get(userId, key) as any)?.mode ?? 'needs_approval';
        if (mode === 'blocked') { noteToolOutcome(botId, seq, { status: 'denied', summary: 'Not allowed' }); return DECLINED; }
        if (forceAsk || mode !== 'always_allow') {
          const a = await requestApproval({ userId, botId }, { key, title: `Local: ${local.ask ?? name}${danger ? ` (careful, it ${danger})` : ''}` }, args, seq);
          if (a !== 'allow') return a === 'deny' ? DECLINED : SKIPPED;
        }
      }
      try {
        const out = await local.run(args, { home, cwd: `${home}/work` });
        noteToolOutcome(botId, seq, { status: /"error"/.test(out.slice(0, 40)) ? 'error' : 'done' });
        return out;
      } catch (e: any) { noteToolOutcome(botId, seq, { status: 'error', summary: String(e?.message ?? e).slice(0, 200) }); throw e; }
    }
    if (name.startsWith('mcp_hq_')) {
      const userId = (db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as any).user_id as string;
      const pol = policyFor(userId, name.slice(7), args);
      if (pol.decision !== 'allow' && !(pol.decision === 'ask' && autoSkips(name, args))) {
        const seq = await claimToolRow(botId, name);
        if (pol.decision === 'block') { noteToolOutcome(botId, seq, { status: 'denied', summary: 'Not allowed' }); return DECLINED; }
        const a = await requestApproval({ userId, botId }, pol, args, seq);
        if (a !== 'allow') return a === 'deny' ? DECLINED : SKIPPED;
      }
      return (await callHqTool(botId, name.slice(7), args)).content.map((c) => c.text).join('\n');
    }
    // Connected apps: read-only tools run, everything else asks first (same cards and policies as the app's own tools).
    await extraTools(botId);
    const userId = (db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as any).user_id as string;
    const pol = policyFor(userId, name, args);
    const seq = await claimToolRow(botId, name);
    if (pol.decision === 'block') { noteToolOutcome(botId, seq, { status: 'denied', summary: 'Not allowed' }); return DECLINED; }
    if (pol.decision === 'ask' && !autoSkips(name, args)) {
      const a = await requestApproval({ userId, botId }, pol, args, seq);
      if (a !== 'allow') return a === 'deny' ? DECLINED : SKIPPED;
    }
    try {
      const out = await callExtraTool(botId, name, args);
      noteToolOutcome(botId, seq, { status: 'done' });
      return out;
    } catch (e: any) { noteToolOutcome(botId, seq, { status: 'error', summary: String(e?.message ?? e).slice(0, 200) }); throw e; }
  } catch (e: any) {
    return JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) });
  }
}

// ---------- settings: providers and models ----------

const groupOf = (p: (typeof PRESETS)[number]) => p.cli ? 'Your subscription' : p.local ? 'On this computer' : /free/i.test(p.name) ? 'Free tiers' : 'API keys';
export const providersApi = new Hono<AuthVars>();
providersApi.use('*', requireUser);
providersApi.get('/providers', async (c) => {
  if (c.req.query('fresh')) forgetCliLookups();
  const out = await Promise.all(PRESETS.map(async (p) => ({ id: p.id, name: p.name, local: !!p.local, keyless: !!p.keyless, connected: p.cli ? cliFound(p.cli.bin) : p.keyless ? (p.local ? (await liveModels(p.id)).ok : true) : hasKey(p.id), models: (await liveModels(p.id)).models, note: p.note ?? null, baseUrl: resolve(p.id).baseUrl, group: groupOf(p), cli: !!p.cli, canLogin: !!p.cli?.login, hasKey: hasKey(p.id), env: p.env ?? null })));
  return c.json({ providers: out, default: DEFAULT_PROVIDER });
});
providersApi.put('/providers/:id', async (c) => {
  const id = c.req.param('id');
  if (!PRESETS.some((p) => p.id === id)) return c.json({ error: 'unknown provider' }, 404);
  const b = await c.req.json<{ apiKey?: string; baseUrl?: string }>();
  saveProvider(id, { ...(b.apiKey !== undefined ? { apiKey: b.apiKey.trim() } : {}), ...(b.baseUrl !== undefined ? { baseUrl: b.baseUrl.trim() } : {}) });
  return c.json({ ok: true });
});

/** One short real question to the provider, so "Connected" means it answers. */
providersApi.post('/providers/:id/test', async (c) => {
  forgetCliLookups();
  const id = c.req.param('id');
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return c.json({ error: 'unknown provider' }, 404);
  try {
    if (preset.cli) {
      if (!cliFound(preset.cli.bin)) return c.json({ error: `"${preset.cli.bin}" is not installed. ${preset.note ?? ''}` }, 409);
      const text = await runCli(preset, 'Reply in at most five words.', [{ role: 'user', content: 'Say hello.' }], AbortSignal.timeout(90_000));
      return c.json({ ok: true, reply: text.trim().slice(0, 200) });
    }
    const { baseUrl, apiKey } = resolve(id);
    const model = (await liveModels(id)).models[0] ?? preset.models[0];
    if (!baseUrl) return c.json({ error: 'Set the address first.' }, 400);
    if (!model) return c.json({ error: 'No model found. Press Refresh or type one in the chat Engine panel.' }, 400);
    const r = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Say hello in two words.' }] }) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return c.json({ error: String(j?.error?.message ?? j?.error ?? `HTTP ${r.status}`).slice(0, 300) }, 502);
    return c.json({ ok: true, model, reply: String(j?.choices?.[0]?.message?.content ?? '').trim().slice(0, 200) });
  } catch (e: any) { return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502); }
});

/** Never opens a terminal window by itself: gives the sign-in command for the user to run. */
providersApi.post('/providers/:id/login', async (c) => {
  const cli = PRESETS.find((p) => p.id === c.req.param('id'))?.cli;
  if (!cli?.login) return c.json({ error: 'No sign-in for this one.' }, 400);
  if (!cliFound(cli.bin)) return c.json({ error: `"${cli.bin}" is not installed yet.` }, 409);
  return c.json({ ok: true, opened: false, command: cli.login });
});
void env; void TOOLS; void toolMap;
