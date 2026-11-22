import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliFound } from './cli.js';

/** Model providers the OpenKrishBot engine can talk to. All speak the OpenAI chat-completions dialect. */
export interface Preset { id: string; name: string; baseUrl: string; keyless?: boolean; local?: boolean; models: string[]; env?: string; note?: string; cli?: { command: string; bin: string; login?: string } }

export const PRESETS: Preset[] = [
  { id: 'pollinations', name: 'Free cloud (Pollinations, no key)', baseUrl: 'https://text.pollinations.ai/openai', keyless: true, models: ['openai-fast', 'openai', 'mistral', 'deepseek', 'qwen-coder', 'llama'], note: 'Free, no sign-up' },
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', keyless: true, local: true, models: [] },
  { id: 'lmstudio', name: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', keyless: true, local: true, models: [] },
  { id: 'llamacpp', name: 'llama.cpp (local)', baseUrl: 'http://127.0.0.1:8080/v1', keyless: true, local: true, models: [] },
  { id: 'openrouter', name: 'OpenRouter (free models + GPT-6 Luna and more)', baseUrl: 'https://openrouter.ai/api/v1', models: ['inclusionai/ling-3.2-flash:free', 'baidu/ernie-5.5-flash-preview:free', 'liquid/lfm-3-1.7b:free', 'particle-ai/particle-1:free', 'recursive/flint-v1.0:free', 'nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free', 'openai/gpt-6-luna', 'openai/gpt-6.2-astra', 'openai/gpt-6.2-sol', 'openai/gpt-5.6-luna', 'anthropic/claude-fable-5.2', 'google/gemini-4-neon'], env: 'OPENROUTER_API_KEY', note: 'One free key. Models ending in :free cost nothing; the rest (GPT-6 Luna, Astra, Claude, Gemini) bill your OpenRouter credit.' },
  { id: 'groq', name: 'Groq (free tier)', baseUrl: 'https://api.groq.com/openai/v1', models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'], env: 'GROQ_API_KEY' },
  { id: 'cerebras', name: 'Cerebras (free tier)', baseUrl: 'https://api.cerebras.ai/v1', models: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-32b'], env: 'CEREBRAS_API_KEY' },
  { id: 'gemini', name: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'], env: 'GEMINI_API_KEY' },
  { id: 'mistral', name: 'Mistral (free tier)', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'], env: 'MISTRAL_API_KEY' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', 'deepseek-ai/DeepSeek-V3'], env: 'TOGETHER_API_KEY' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], env: 'DEEPSEEK_API_KEY' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], env: 'OPENAI_API_KEY' },
  { id: 'claude-cli', name: 'Claude (your Pro/Max plan, via Claude Code)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Claude Code and run `claude` once to sign in', cli: { command: 'claude -p', bin: 'claude', login: 'claude' } },
  { id: 'codex-cli', name: 'ChatGPT (your Plus/Pro plan, via Codex)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Codex CLI and run `codex login`', cli: { command: 'codex exec --skip-git-repo-check -', bin: 'codex', login: 'codex login' } },
  { id: 'gemini-cli', name: 'Gemini (your Google account, via Gemini CLI)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Gemini CLI and run `gemini` once (has a free tier)', cli: { command: 'gemini -p " "', bin: 'gemini', login: 'gemini' } },
  { id: 'grok-cli', name: 'Grok (via Grok CLI)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Grok CLI and sign in', cli: { command: 'grok -p', bin: 'grok', login: 'grok' } },
  { id: 'kimi-cli', name: 'Kimi (via Kimi CLI)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Kimi CLI and sign in', cli: { command: 'kimi --print', bin: 'kimi', login: 'kimi' } },
  { id: 'cursor-cli', name: 'Cursor (via cursor-agent)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Cursor CLI, run `cursor-agent login`', cli: { command: 'cursor-agent -p', bin: 'cursor-agent', login: 'cursor-agent login' } },
  { id: 'vibe-cli', name: 'Mistral (via Vibe CLI)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Install Mistral Vibe and sign in', cli: { command: 'vibe -p', bin: 'vibe', login: 'vibe' } },
  { id: 'antigravity-cli', name: 'Google Gemini (Antigravity)', baseUrl: '', keyless: true, local: true, models: ['default'], note: 'Signed-in Antigravity/Gemini account', cli: { command: 'gemini -p " "', bin: 'gemini', login: 'gemini' } },
  { id: 'opencode-cli', name: 'OpenCode (via OpenCode CLI)', baseUrl: '', keyless: true, local: true, models: ['default'], cli: { command: 'opencode run', bin: 'opencode', login: 'opencode auth login' } },
  { id: 'qwen-cli', name: 'Qwen Code', baseUrl: '', keyless: true, local: true, models: ['default'], cli: { command: 'qwen -p " "', bin: 'qwen', login: 'qwen' } },
  { id: 'anthropic', name: 'Anthropic (Claude API)', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'], env: 'ANTHROPIC_API_KEY' },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', models: ['grok-4', 'grok-code-fast-1'], env: 'XAI_API_KEY' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', models: [], env: 'FIREWORKS_API_KEY' },
  { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', models: [], env: 'NVIDIA_API_KEY' },
  { id: 'huggingface', name: 'Hugging Face router', baseUrl: 'https://router.huggingface.co/v1', models: [], env: 'HF_TOKEN' },
  { id: 'moonshot', name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.ai/v1', models: [], env: 'MOONSHOT_API_KEY' },
  { id: 'zai', name: 'Z.ai (GLM)', baseUrl: 'https://api.z.ai/api/paas/v4', models: [], env: 'ZAI_API_KEY' },
  { id: 'githubmodels', name: 'GitHub Models', baseUrl: 'https://models.github.ai/inference', models: [], env: 'GITHUB_TOKEN' },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', models: ['sonar'], env: 'PERPLEXITY_API_KEY' },
  { id: 'custom', name: 'Custom OpenAI-compatible', baseUrl: '', models: [] },
];

export const DEFAULT_PROVIDER = 'pollinations';

interface Saved { apiKey?: string; baseUrl?: string }
const file = path.join(os.homedir(), '.openkrishbot', 'providers.json');

function load(): Record<string, Saved> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export function saveProvider(id: string, patch: Saved) {
  const all = load();
  all[id] = { ...all[id], ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
}

export function resolve(id: string | null | undefined): { preset: Preset; baseUrl: string; apiKey: string } {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PROVIDER)!;
  const saved = load()[preset.id] ?? {};
  const apiKey = saved.apiKey || (preset.env ? process.env[preset.env] ?? '' : '');
  return { preset, baseUrl: (saved.baseUrl || preset.baseUrl).replace(/\/+$/, ''), apiKey };
}

export const hasKey = (id: string) => !!resolve(id).apiKey;

/** Live model list for a provider (Ollama/LM Studio/custom list what is installed); falls back to the preset's. */
const listed = new Map<string, { at: number; v: { ok: boolean; models: string[] } }>();
export async function liveModels(id: string): Promise<{ ok: boolean; models: string[] }> {
  const { preset, baseUrl, apiKey } = resolve(id);
  const k = `${id}|${baseUrl}|${apiKey}`;
  const hit = listed.get(k);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = await fetchModels(id);
  listed.set(k, { at: Date.now(), v });
  return v;
}

async function fetchModels(id: string): Promise<{ ok: boolean; models: string[] }> {
  const { preset, baseUrl, apiKey } = resolve(id);
  // a cloud provider that needs a key and has none cannot answer: show its built-in list without waiting on the network
  if (!preset.keyless && !apiKey && !preset.cli) return { ok: false, models: preset.models };
  if (preset.cli) return { ok: cliFound(preset.cli.bin), models: preset.models };
  if (!baseUrl) return { ok: false, models: [] };
  try {
    const r = await fetch(`${baseUrl}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(preset.local ? 1200 : 4000) });
    if (!r.ok) return { ok: preset.keyless === true && !preset.local, models: preset.models };
    const j: any = await r.json();
    const ids: string[] = (Array.isArray(j) ? j : j.data ?? j.models ?? []).map((m: any) => String(m.id ?? m.name ?? m)).filter(Boolean);
    return { ok: true, models: ids.length ? (preset.local ? ids : [...new Set([...preset.models, ...ids])].slice(0, 60)) : preset.models };
  } catch {
    return { ok: preset.keyless === true && !preset.local, models: preset.models };
  }
}
