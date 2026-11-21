import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_TOOLS } from '../screen/tools.js';

/** Local tools every Krishbot agent has (from the OpenManus toolset: shell, python, file edit, web). They run on this computer. */
export interface LocalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Needs the user's OK unless they chose "always allow" for it. */
  ask?: string;
  run(args: any, ctx: { home: string; cwd: string }): Promise<string>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const cap = (s: string, n = 12000) => (s.length > n ? `${s.slice(0, n / 2)}\n…[${s.length - n} chars cut]…\n${s.slice(-n / 2)}` : s);

function sh(cmd: string, args: string[], cwd: string, timeoutSec: number, input?: string): Promise<string> {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { cwd, timeout: timeoutSec * 1000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TERM: 'dumb' } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
      resolve(JSON.stringify({ exit_code: code, output: cap(`${stdout ?? ''}${stderr ?? ''}`) }));
    });
    if (input !== undefined) p.stdin?.end(input);
  });
}

const abs = (p: string, cwd: string) => (path.isAbsolute(p) ? p : path.join(cwd, p));
const stripHtml = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const BASE_TOOLS: LocalTool[] = [
  {
    name: 'terminal', ask: 'Run a command on your computer',
    description: 'Run a shell command on the user\'s computer and get its output. Use for anything: files, git, installs, scripts.',
    parameters: obj({ command: { type: 'string' }, timeout: { type: 'number', description: 'seconds, default 60' } }, ['command']),
    run: (a, c) => sh(process.platform === 'win32' ? 'cmd' : 'bash', process.platform === 'win32' ? ['/c', String(a.command)] : ['-lc', String(a.command)], c.cwd, Math.min(Number(a.timeout) || 60, 600)),
  },
  {
    name: 'execute_code', ask: 'Run Python code',
    description: 'Run Python 3 code and return what it prints. Good for calculations, data work, charts saved to files.',
    parameters: obj({ code: { type: 'string' } }, ['code']),
    run: (a, c) => sh(process.platform === 'win32' ? 'python' : 'python3', ['-'], c.cwd, 120, String(a.code)),
  },
  {
    name: 'read_file',
    description: 'Read a text file. Relative paths are inside the bot\'s workspace.',
    parameters: obj({ path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number', description: 'max lines, default 400' } }, ['path']),
    async run(a, c) {
      const lines = fs.readFileSync(abs(String(a.path), c.cwd), 'utf8').split('\n');
      const o = Math.max(0, Number(a.offset) || 0);
      const n = Math.min(Number(a.limit) || 400, 2000);
      return cap(lines.slice(o, o + n).map((l, i) => `${o + i + 1}\t${l}`).join('\n'));
    },
  },
  {
    name: 'write_file', ask: 'Write a file',
    description: 'Create or overwrite a file with the given content.',
    parameters: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    async run(a, c) {
      const f = abs(String(a.path), c.cwd);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, String(a.content));
      return `Wrote ${f} (${String(a.content).length} chars)`;
    },
  },
  {
    name: 'patch', ask: 'Edit a file',
    description: 'Replace one exact occurrence of old_text with new_text in a file (str_replace). old_text must match exactly once.',
    parameters: obj({ path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']),
    async run(a, c) {
      const f = abs(String(a.path), c.cwd);
      const s = fs.readFileSync(f, 'utf8');
      const n = s.split(String(a.old_text)).length - 1;
      if (n !== 1) return JSON.stringify({ error: n === 0 ? 'old_text not found' : `old_text matches ${n} times; add more context` });
      fs.writeFileSync(f, s.replace(String(a.old_text), () => String(a.new_text)));
      return 'Edited ' + f;
    },
  },
  {
    name: 'search_files',
    description: 'List files in a folder, or search file contents with a regex (grep).',
    parameters: obj({ path: { type: 'string', description: 'folder, default workspace' }, pattern: { type: 'string', description: 'regex to search for in contents (optional)' } }),
    run: (a, c) => sh('bash', ['-c', a.pattern ? 'grep -rIn --exclude-dir=node_modules --exclude-dir=.git -m 5 -E "$1" . | head -100' : 'ls -la', '_', String(a.pattern ?? '')], abs(String(a.path ?? '.'), c.cwd), 30),
  },
  {
    name: 'web_search',
    description: 'Search the web (DuckDuckGo). Returns titles, links and snippets.',
    parameters: obj({ query: { type: 'string' } }, ['query']),
    async run(a) {
      const r = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0' }, body: `q=${encodeURIComponent(String(a.query))}`, signal: AbortSignal.timeout(20000) });
      const html = await r.text();
      const out: string[] = [];
      for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
        const u = decodeURIComponent((/uddg=([^&]+)/.exec(m[1]) ?? [, m[1]])[1] as string);
        out.push(`- ${stripHtml(m[2])}\n  ${u}\n  ${stripHtml(m[3])}`);
        if (out.length >= 8) break;
      }
      return out.join('\n') || 'No results.';
    },
  },
  {
    name: 'web_extract',
    description: 'Fetch a web page and return its readable text.',
    parameters: obj({ url: { type: 'string' } }, ['url']),
    async run(a) {
      const r = await fetch(String(a.url), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(25000) });
      const t = await r.text();
      return cap(/html/i.test(r.headers.get('content-type') ?? '') ? stripHtml(t) : t, 15000);
    },
  },
  {
    name: 'memory',
    description: 'Save a short note you want to remember about the user or the work (kept across conversations).',
    parameters: obj({ note: { type: 'string' }, about: { type: 'string', enum: ['work', 'user'] } }, ['note']),
    async run(a, c) {
      const f = path.join(c.home, 'memories', a.about === 'user' ? 'USER.md' : 'MEMORY.md');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trimEnd() : '';
      fs.writeFileSync(f, `${old ? `${old}\n§\n` : ''}${String(a.note).trim()}\n`);
      return 'Saved.';
    },
  },
];

export const LOCAL_TOOLS: LocalTool[] = [...BASE_TOOLS, ...BROWSER_TOOLS];
export const localToolMap = new Map(LOCAL_TOOLS.map((t) => [t.name, t]));
export const botHome = (botId: string) => path.join(os.homedir(), '.krishbot', 'bots', botId);
