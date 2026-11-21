import fs from 'node:fs';
import { db } from './db.js';
import { hub } from './lib/hub.js';
import { libraryRoot, profilesRoot } from './paths.js';
import { closeScreen, runningBots, screenOf } from './screen/manager.js';
import type { ComputerState } from './types.js';

/** This computer: one private Chrome per bot, started the first time the bot or the person needs it. */

export function computerState(userId: string): ComputerState {
  const bots = new Set(runningBots());
  const screens = (db.prepare('SELECT id FROM bots WHERE user_id=?').all(userId) as { id: string }[])
    .filter((b) => bots.has(b.id)).map((b) => ({ botId: b.id, screenId: b.id, width: 1280, height: 800 }));
  return { status: 'running', orgoId: null, error: null, screens, maxScreens: 64 };
}

const announce = (userId: string) => hub.emit(userId, { type: 'computer', state: computerState(userId) });
const ownerOf = (botId: string) => (db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as { user_id: string } | undefined)?.user_id;

export const ensureComputer = async (_userId: string) => 'local';
export const refreshComputer = async (userId: string) => computerState(userId);
export async function suspendComputer(_userId: string, _reason = 'manual'): Promise<void> {}

export async function readyScreen(userId: string, botId: string) {
  await screenOf(botId);
  announce(userId);
  return { screenId: botId };
}

/** Called before a bot starts working. The browser starts on demand when it uses one, so nothing to do. */
export async function screenForWork(_userId: string, _botId: string): Promise<void> {}

/** Close the bot's browser. The next use starts it again with the same logins. */
export async function resetBotScreen(userId: string, botId: string): Promise<void> {
  closeScreen(botId);
  announce(userId);
}

export async function releaseScreen(botId: string): Promise<void> {
  closeScreen(botId);
  const u = ownerOf(botId);
  if (u) announce(u);
}

/** A deleted bot leaves nothing behind: its browser profile and its Library folder go. */
export async function forgetBotFiles(botId: string): Promise<void> {
  if (!/^bot_[\w-]+$/.test(botId)) return;
  for (const dir of [`${profilesRoot()}/${botId}`, `${libraryRoot()}/${botId}`]) fs.rmSync(dir, { recursive: true, force: true });
}
