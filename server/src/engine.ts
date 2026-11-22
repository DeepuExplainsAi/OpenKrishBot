import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from './db.js';
import { env } from './env.js';
import { DEFAULT_PROVIDER, PRESETS, hasKey, liveModels, resolve } from './krish/providers.js';
import { botHome } from './krish/tools.js';
import type { EngineInfo, EngineProvider } from './types.js';

/**
 * Every bot runs on the OpenKrishBot engine (server/src/krish): an agent loop inside this server that
 * talks to any OpenAI-compatible model. No separate process, no account, no cloud.
 */

export type EngineKind = 'primary' | 'managed';
export interface Engine { kind: EngineKind; url: string; key: string; home: string }

const botRow = (botId: string) => db.prepare('SELECT * FROM bots WHERE id=?').get(botId) as any;
const hmac = (what: string) => crypto.createHmac('sha256', env.sessionSecret).update(what).digest('hex');

/** Token the app's MCP endpoint expects from a bot's agent. `primary` names the primary bot. */
export const mcpToken = (botId: string): string => hmac(`mcp:${botId}`);
/** Key the in-process engine endpoint expects from this server's own turn loop. */
export const engineKey = (): string => hmac('krish-engine');

export function primaryBotId(): string | null {
  return (db.prepare("SELECT id FROM bots WHERE engine='primary' LIMIT 1").get() as any)?.id ?? null;
}

export function engineKind(botId: string): EngineKind | null {
  const e = botRow(botId)?.engine;
  return e === 'primary' || e === 'managed' ? e : null;
}

export function assignEngine(botId: string): EngineKind {
  const b = botRow(botId);
  if (!b) throw new Error('bot not found');
  if (b.engine === 'primary' || b.engine === 'managed') return b.engine;
  const kind: EngineKind = primaryBotId() ? 'managed' : 'primary';
  db.prepare('UPDATE bots SET engine=?, engine_port=NULL WHERE id=?').run(kind, botId);
  return kind;
}

export async function engineFor(botId: string): Promise<Engine> {
  const b = botRow(botId);
  if (!b) throw new Error('bot not found');
  if (b.kind === 'room') throw new Error('A group chat has no agent of its own.');
  const kind = engineKind(botId) ?? assignEngine(botId);
  return { kind, url: `http://127.0.0.1:${env.port}/krish`, key: engineKey(), home: botHome(botId) };
}

export function engineHome(botId: string): string | null {
  return engineKind(botId) ? botHome(botId) : null;
}

export const syncPersona = (_botId: string) => {};
export const provisionEngine = (_botId: string) => {};
export const restartEngine = async (_botId: string) => {};
export const forgetEngineOptions = (_botId: string) => {};
export const ownScreenOn = (_botId: string) => false;
export const stopOwnScreen = async (_botId: string) => {};
export const initEngines = () => {
  for (const b of db.prepare("SELECT id FROM bots WHERE engine IS NULL AND COALESCE(kind,'agent') <> 'room' ORDER BY is_primary DESC, created_at ASC").all() as any[]) assignEngine(b.id);
};

export async function removeEngine(botId: string): Promise<void> {
  fs.rmSync(botHome(botId), { recursive: true, force: true });
}

export async function engineInfo(botId: string): Promise<EngineInfo> {
  const b = botRow(botId);
  if (!b) throw new Error('bot not found');
  const providers: EngineProvider[] = await Promise.all(PRESETS.map(async (p) => ({
    id: p.id,
    name: p.name,
    kind: 'api_key' as const,
    connected: p.keyless ? (p.local ? (await liveModels(p.id)).ok : true) : hasKey(p.id),
    models: (await liveModels(p.id)).models.slice(0, 40),
  })));
  const provider = b.provider ?? DEFAULT_PROVIDER;
  return {
    botId, profile: botId, status: 'ready', error: null,
    model: b.model ?? resolve(provider).preset.models[0] ?? null,
    provider, version: 'openkrishbot', providers, ownScreen: false,
  };
}
