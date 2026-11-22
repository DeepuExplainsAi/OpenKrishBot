import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { launchEnv } from '../lib/launch.js';
import type { Preset } from './providers.js';

/** Subscription models: a command-line assistant that is signed in with the user's own plan. The prompt goes on stdin. */
export function cliFound(bin: string): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore', env: launchEnv() }).status === 0;
}

export function runCli(p: Preset, system: string, history: { role: string; content?: string | null }[], signal: AbortSignal): Promise<string> {
  const cli = p.cli!;
  const transcript = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content).slice(-30)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const flags = /^claude\b/.test(cli.command) ? ' --dangerously-skip-permissions' : /^codex\b/.test(cli.command) ? ' --full-auto' : /^gemini\b/.test(cli.command) ? ' --yolo --skip-trust' : '';
  return new Promise((resolve, reject) => {
    if (!cliFound(cli.bin)) return reject(new Error(`"${cli.bin}" is not installed. Install it, then sign in with \`${cli.login ?? cli.bin}\` in a terminal.`));
    const child = spawn(cli.command + flags, { shell: true, cwd: os.homedir(), env: { ...process.env, ...launchEnv({ GEMINI_CLI_TRUST_WORKSPACE: 'true' }) }, windowsHide: true });
    let out = '', err = '';
    signal.addEventListener('abort', () => child.kill(), { once: true });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal.aborted) return reject(new Error('Stopped.'));
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`"${cli.bin}" failed (${code}). ${err.trim().slice(0, 400) || `Is it signed in? Run \`${cli.login ?? cli.bin}\` in a terminal.`}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${system}\n\n${transcript}\n\nAssistant:`);
  });
}
