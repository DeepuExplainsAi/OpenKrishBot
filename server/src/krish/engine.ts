import { Hono } from 'hono';
import fs from 'node:fs';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser, type AuthVars } from '../lib/auth.js';
import { engineKey } from '../engine.js';
import { DEFAULT_PROVIDER, PRESETS, hasKey, liveModels, resolve, saveProvider } from './providers.js';
import { botHome, localToolMap, LOCAL_TOOLS } from './tools.js';
import { TOOLS, toolMap } from '../agent/tools.js';
import { callTool as callHqTool, listTools as listHqTools } from '../mcp.js';
import { claimToolRow, noteToolOutcome, requestApproval } from '../agent/loop.js';
import { extraTools, callExtraTool } from './mcp-client.js';

/**
 * The Krishbot engine: an agent loop that lives inside this server. It speaks the same event stream
 * as a Hermes gateway's /v1/responses, so the chat, approvals and activity UI work unchanged, with no
 * second process, no cloud and no account. Models come from any OpenAI-compatible endpoint.
 */

export const krishApi = new Hono();

krishApi.use('/v1/*', async (c, next) => {
  if ((c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '') !== engineKey()) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | null; tool_calls?: any[]; tool_call_id?: string };
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

async function chat(botId: string, body: any, signal: AbortSignal) {
  const bot = db.prepare('SELECT * FROM bots WHERE id=?').get(botId) as any;
  const { preset, baseUrl, apiKey } = resolve(body.provider ?? bot?.provider);
  if (!baseUrl) throw new Error('This provider has no address yet. Set it in the bot\'s Engine panel.');
  if (!preset.keyless && !apiKey) throw new Error(`${preset.name} needs an API key. Add it in the bot's Engine panel, or pick a free provider.`);
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function* deltas(res: Response) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try { yield JSON.parse(raw); } catch { /* partial */ }
    }
  }
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
  const system = `${b.instructions ?? ''}\n\n## Your computer\nYou run on the user's own computer, with a shell, files, Python and the web. Your workspace folder is ${home}/work. Be careful with anything destructive.${memory ? `\n\n## What you remember\n- ${memory}` : ''}`;

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(sse(event, data)));
      let n = 0;
      try {
        const tools = await toolsFor(botId);
        for (let step = 0; step < MAX_STEPS; step++) {
          const res = await chat(botId, { model, stream: true, messages: [{ role: 'system', content: system }, ...history.slice(-MAX_HISTORY)], ...(tools.length ? { tools, tool_choice: 'auto' } : {}), ...(effort && /gpt-5|o\d|gpt-oss/.test(model) ? { reasoning_effort: effort } : {}) }, c.req.raw.signal);
          if (!res.ok || !res.body) throw new Error(`${preset.name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
          let text = '';
          const calls: Record<number, { id: string; name: string; args: string }> = {};
          for await (const j of deltas(res)) {
            const d = j.choices?.[0]?.delta;
            if (!d) continue;
            const r = d.reasoning ?? d.reasoning_content;
            if (r) send('response.reasoning_summary_text.delta', { delta: r });
            if (d.content) { text += d.content; send('response.output_text.delta', { delta: d.content }); }
            for (const tc of d.tool_calls ?? []) {
              const k = calls[tc.index ?? 0] ??= { id: tc.id ?? `call_${Date.now()}_${n++}`, name: '', args: '' };
              if (tc.id) k.id = tc.id;
              if (tc.function?.name) k.name += tc.function.name;
              if (tc.function?.arguments) k.args += tc.function.arguments;
            }
          }
          const list = Object.values(calls).filter((k) => k.name);
          history.push({ role: 'assistant', content: text || null, ...(list.length ? { tool_calls: list.map((k) => ({ id: k.id, type: 'function', function: { name: k.name, arguments: k.args || '{}' } })) } : {}) });
          if (text) send('response.output_item.done', { item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
          if (!list.length) break;
          for (const k of list) {
            send('response.output_item.added', { item: { type: 'function_call', call_id: k.id, name: k.name, arguments: k.args || '{}' } });
            const out = await runTool(botId, k.name, k.args, home);
            history.push({ role: 'tool', tool_call_id: k.id, content: out });
            send('response.output_item.done', { item: { type: 'function_call_output', call_id: k.id, output: out } });
          }
        }
        send('response.completed', { response: { status: 'completed' } });
      } catch (e: any) {
        if (!c.req.raw.signal.aborted) send('response.failed', { response: { error: { message: String(e?.message ?? e) } } });
      } finally {
        threads.set(convo, history.slice(-MAX_HISTORY * 2));
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
});

async function runTool(botId: string, name: string, rawArgs: string, home: string): Promise<string> {
  let args: any = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return JSON.stringify({ error: 'The tool arguments were not valid JSON. Try again.' }); }
  const local = localToolMap.get(name);
  try {
    if (local) {
      // Local tools go through the same approval cards as every other write.
      const userId = (db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as any).user_id as string;
      const seq = await claimToolRow(botId, name);
      if (local.ask) {
        const key = `local:${name}`;
        const mode = (db.prepare('SELECT mode FROM policies WHERE user_id=? AND tool=?').get(userId, key) as any)?.mode ?? 'needs_approval';
        if (mode === 'blocked') { noteToolOutcome(botId, seq, { status: 'denied', summary: 'Not allowed' }); return DECLINED; }
        if (mode !== 'always_allow') {
          const a = await requestApproval({ userId, botId }, { key, title: `Local: ${local.ask}` }, args, seq);
          if (a !== 'allow') return a === 'deny' ? DECLINED : SKIPPED;
        }
      }
      try {
        const out = await local.run(args, { home, cwd: `${home}/work` });
        noteToolOutcome(botId, seq, { status: /"error"/.test(out.slice(0, 40)) ? 'error' : 'done' });
        return out;
      } catch (e: any) { noteToolOutcome(botId, seq, { status: 'error', summary: String(e?.message ?? e).slice(0, 200) }); throw e; }
    }
    if (name.startsWith('mcp_hq_')) return (await callHqTool(botId, name.slice(7), args)).content.map((c) => c.text).join('\n');
    return await callExtraTool(botId, name, args);
  } catch (e: any) {
    return JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) });
  }
}

// ---------- settings: providers and models ----------

export const providersApi = new Hono<AuthVars>();
providersApi.use('*', requireUser);
providersApi.get('/providers', async (c) => {
  const out = await Promise.all(PRESETS.map(async (p) => ({ id: p.id, name: p.name, local: !!p.local, keyless: !!p.keyless, connected: p.keyless ? (p.local ? (await liveModels(p.id)).ok : true) : hasKey(p.id), models: (await liveModels(p.id)).models, note: p.note ?? null, baseUrl: resolve(p.id).baseUrl })));
  return c.json({ providers: out, default: DEFAULT_PROVIDER });
});
providersApi.put('/providers/:id', async (c) => {
  const id = c.req.param('id');
  if (!PRESETS.some((p) => p.id === id)) return c.json({ error: 'unknown provider' }, 404);
  const b = await c.req.json<{ apiKey?: string; baseUrl?: string }>();
  saveProvider(id, { ...(b.apiKey !== undefined ? { apiKey: b.apiKey.trim() } : {}), ...(b.baseUrl !== undefined ? { baseUrl: b.baseUrl.trim() } : {}) });
  return c.json({ ok: true });
});
void env; void TOOLS; void toolMap;
