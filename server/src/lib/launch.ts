import os from 'node:os';
import path from 'node:path';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

/** An installed app is started from the desktop with a short PATH. Add where Node/npx/uvx usually live, and run npx as npx.cmd on Windows. */
export function launchEnv(extra: Record<string, string> = {}): Record<string, string> {
  const sep = process.platform === 'win32' ? ';' : ':';
  const bins = process.platform === 'win32'
    ? ['C:\\Program Files\\nodejs', path.join(process.env.APPDATA ?? '', 'npm')]
    : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.cargo/bin')];
  const have = (process.env.PATH ?? '').split(sep);
  const PATH = [...have, ...bins.filter((b) => b && !have.includes(b))].join(sep);
  return { ...getDefaultEnvironment(), PATH, ...extra };
}
export const launchCommand = (c: string) => (process.platform === 'win32' && /^(npx|npm|uvx)$/i.test(c) ? `${c}.cmd` : c);
