import { spawn, spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import os from 'node:os';
import { launchEnv } from '../lib/launch.js';
import type { Preset } from './providers.js';

/** Subscription models: a command-line assistant that is signed in with the user's own plan. The prompt goes on stdin. */
export const forgetCliLookups = () => found.clear();
const found = new Map<string, { at: number; ok: boolean }>();
/** Cached for 30 s: this spawns a process, and the settings pages ask for every CLI on every open. */
export function cliFound(bin: string): boolean {
  const hit = found.get(bin);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  const ok = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore', env: launchEnv(), windowsHide: true }).status === 0;
  found.set(bin, { at: Date.now(), ok });
  return ok;
}

/** CLI noise that is not an answer and not an error: colour-support and auto-approve notices, update nags. */
const NOISE = /256-color|colour support|color support|YOLO mode|tool calls will be automatically approved|Loaded cached credentials|update available|ripgrep|Ripgrep|^\s*$/i;
export const cleanCliText = (t: string) => stripVTControlCharacters(t).split(/\r?\n/).filter((l) => !NOISE.test(l)).join('\n').trim();
const modelFlag = (cmd: string, model?: string | null) => (!model || model === 'default' ? '' : /^claude\b/.test(cmd) ? ` --model ${model}` : /^(codex|gemini)\b/.test(cmd) ? ` -m ${model}` : '');

export function runCli(p: Preset, system: string, history: { role: string; content?: string | any[] | null }[], signal: AbortSignal, model?: string | null): Promise<string> {
  const cli = p.cli!;
  const transcript = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content).slice(-30)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const flags = /^claude\b/.test(cli.command) ? ' --dangerously-skip-permissions' : /^codex\b/.test(cli.command) ? ' --full-auto' : /^gemini\b/.test(cli.command) ? ' --yolo --skip-trust' : '';
  return new Promise((resolve, reject) => {
    if (!cliFound(cli.bin)) return reject(new Error(`"${cli.bin}" is not installed. Install it, then sign in with \`${cli.login ?? cli.bin}\` in a terminal.`));
    const child = spawn(cli.command + modelFlag(cli.command, model) + flags, { shell: true, cwd: os.homedir(), env: { ...process.env, ...launchEnv({ GEMINI_CLI_TRUST_WORKSPACE: 'true', NO_COLOR: '1', FORCE_COLOR: '0' }) }, windowsHide: true });
    let out = '', err = '';
    signal.addEventListener('abort', () => child.kill(), { once: true });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal.aborted) return reject(new Error('Stopped.'));
      const answer = cleanCliText(out), problem = cleanCliText(err);
      if (code === 0 && answer) resolve(answer);
      else reject(new Error(`${cli.bin} could not answer: ${problem.split('\n').slice(-3).join(' ').slice(-300) || 'it is probably not signed in. Press "Sign in with your account" in Settings > Models.'}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${system}\n\n${transcript}\n\nAssistant:`);
  });
}

/** Opens a link in the user's normal browser. */
export function openInBrowser(url: string) {
  if (!/^https:\/\//.test(url)) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}

/** Opens a terminal running the sign-in command. Only called from the user's click on "Sign in", for CLIs that insist on a terminal. */
function openTerminal(command: string) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', 'cmd', '/k', command]]
    : process.platform === 'darwin' ? ['osascript', ['-e', `tell application "Terminal" to do script "${command}"`, '-e', 'tell application "Terminal" to activate']]
    : ['x-terminal-emulator', ['-e', command]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

/** Claude and Codex sign in through the browser by themselves; the rest need a terminal. */
const BROWSER_LOGIN = /^(claude|codex)\b/;

/** Starts the sign-in. Returns what the user should see: the link that was opened, or a note that a terminal opened. */
export function startLogin(p: Preset): Promise<{ mode: 'browser' | 'terminal'; url?: string }> {
  const login = p.cli!.login!;
  if (!BROWSER_LOGIN.test(login)) { openTerminal(login); return Promise.resolve({ mode: 'terminal' }); }
  const cmd = /^claude\b/.test(login) ? 'claude auth login' : login;
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd: os.homedir(), env: { ...process.env, ...launchEnv({ NO_COLOR: '1', ...(/^claude\b/.test(login) ? { BROWSER: 'true' } : {}) }) }, windowsHide: true });
    let seen = '', done = false;
    const finish = (url?: string) => { if (done) return; done = true; if (url && /^claude\b/.test(login)) openInBrowser(url); resolve({ mode: 'browser', url }); };
    const onData = (d: Buffer) => { seen += stripVTControlCharacters(String(d)); const m = seen.match(/https:\/\/\S+/); if (m) finish(m[0].replace(/[).,]+$/, '')); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', () => finish());
    setTimeout(() => finish(), 4000);
    setTimeout(() => child.kill(), 10 * 60_000).unref();
  });
}
