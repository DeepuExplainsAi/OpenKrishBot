import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Model providers the Krishbot engine can talk to. All speak the OpenAI chat-completions dialect. */
export interface Preset { id: string; name: string; baseUrl: string; keyless?: boolean; local?: boolean; models: string[]; env?: string; note?: string }

export const PRESETS: Preset[] = [
  { id: 'pollinations', name: 'Free cloud (Pollinations, no key)', baseUrl: 'https://text.pollinations.ai/openai', keyless: true, models: ['openai-fast', 'openai', 'mistral', 'deepseek', 'qwen-coder', 'llama'], note: 'Free, no sign-up' },
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', keyless: true, local: true, models: [] },
  { id: 'lmstudio', name: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', keyless: true, local: true, models: [] },
  { id: 'llamacpp', name: 'llama.cpp (local)', baseUrl: 'http://127.0.0.1:8080/v1', keyless: true, local: true, models: [] },
  { id: 'openrouter', name: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1', models: ['openrouter/free', 'deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-coder:free', 'openai/gpt-oss-120b:free', 'meta-llama/llama-3.3-70b-instruct:free'], env: 'OPENROUTER_API_KEY' },
  { id: 'groq', name: 'Groq (free tier)', baseUrl: 'https://api.groq.com/openai/v1', models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'], env: 'GROQ_API_KEY' },
  { id: 'cerebras', name: 'Cerebras (free tier)', baseUrl: 'https://api.cerebras.ai/v1', models: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-32b'], env: 'CEREBRAS_API_KEY' },
  { id: 'gemini', name: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'], env: 'GEMINI_API_KEY' },
  { id: 'mistral', name: 'Mistral (free tier)', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'], env: 'MISTRAL_API_KEY' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', 'deepseek-ai/DeepSeek-V3'], env: 'TOGETHER_API_KEY' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'], env: 'DEEPSEEK_API_KEY' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], env: 'OPENAI_API_KEY' },
  { id: 'custom', name: 'Custom OpenAI-compatible', baseUrl: '', models: [] },
];

export const DEFAULT_PROVIDER = 'pollinations';

interface Saved { apiKey?: string; baseUrl?: string }
const file = path.join(os.homedir(), '.krishbot', 'providers.json');

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
export async function liveModels(id: string): Promise<{ ok: boolean; models: string[] }> {
  const { preset, baseUrl, apiKey } = resolve(id);
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
