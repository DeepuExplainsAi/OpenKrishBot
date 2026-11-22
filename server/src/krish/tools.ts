import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_TOOLS } from '../screen/tools.js';
import { stamp, transcribeFile, transcriptText } from '../transcribe.js';

/** Local tools every OpenKrishBot agent has (from the OpenManus toolset: shell, python, file edit, web). They run on this computer. */
export interface LocalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Needs the user's OK unless they chose "always allow" for it. */
  ask?: string;
  run(args: any, ctx: { home: string; cwd: string }): Promise<string>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
import { fetchPage } from './scrape.js';
const cap = (s: string, n = 12000) => (s.length > n ? `${s.slice(0, n / 2)}\n…[${s.length - n} chars cut]…\n${s.slice(-n / 2)}` : s);

function sh(cmd: string, args: string[], cwd: string, timeoutSec: number, input?: string): Promise<string> {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { cwd, timeout: timeoutSec * 1000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TERM: 'dumb' } }, (err, stdout, stderr) => {
      const e = err as any;
      const code = err ? (typeof e.code === 'number' ? e.code : 1) : 0;
      const note = e?.killed ? `\n[timed out after ${timeoutSec}s and was stopped]` : e?.code === 'ENOENT' ? `\n[${cmd} is not installed or not on PATH]` : '';
      resolve(JSON.stringify({ exit_code: code, output: cap(`${stdout ?? ''}${stderr ?? ''}${note}`) }));
    });
    if (input !== undefined) p.stdin?.end(input);
  });
}

const abs = (p: string, cwd: string) => (path.isAbsolute(p) ? p : path.join(cwd, p));
const stripHtml = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__']);

/** List a folder, or grep file contents. Pure Node so it works the same on Windows, Mac and Linux. */
function searchFiles(root: string, pattern: string | null): string {
  if (!pattern) {
    return fs.readdirSync(root, { withFileTypes: true }).map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n') || '(empty folder)';
  }
  let re: RegExp;
  try { re = new RegExp(pattern); } catch (e: any) { return JSON.stringify({ error: `bad regex: ${e.message}` }); }
  const hits: string[] = [];
  let scanned = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hits.length >= 100 || scanned > 5000) return;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(f); continue; }
      if (!e.isFile()) continue;
      scanned++;
      let text: string;
      try { if (fs.statSync(f).size > 2_000_000) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (text.includes('\0')) continue;
      let per = 0;
      for (const [i, line] of text.split('\n').entries()) {
        if (re.test(line)) { hits.push(`${path.relative(root, f)}:${i + 1}:${line.slice(0, 300)}`); if (++per >= 5 || hits.length >= 100) break; }
      }
    }
  };
  walk(root);
  return hits.join('\n') || 'No matches.';
}

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
      const existed = fs.existsSync(f);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, String(a.content));
      return `${existed ? 'Overwrote' : 'Created'} ${f} (${String(a.content).length} chars)`;
    },
  },
  {
    name: 'patch', ask: 'Edit a file',
    description: 'Replace one exact occurrence of old_text with new_text in a file (str_replace). old_text must match exactly once.',
    parameters: obj({ path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']),
    async run(a, c) {
      const f = abs(String(a.path), c.cwd);
      const raw = fs.readFileSync(f, 'utf8');
      // Windows files use CRLF; the model writes LF. Match on LF, write back in the file's own style.
      const crlf = raw.includes('\r\n');
      const s = raw.replace(/\r\n/g, '\n');
      const oldT = String(a.old_text).replace(/\r\n/g, '\n');
      const newT = String(a.new_text).replace(/\r\n/g, '\n');
      const n = s.split(oldT).length - 1;
      if (!oldT) return JSON.stringify({ error: 'old_text is empty' });
      if (n !== 1) return JSON.stringify({ error: n === 0 ? 'old_text not found' : `old_text matches ${n} times; add more context` });
      const out = s.replace(oldT, () => newT);
      fs.writeFileSync(f, crlf ? out.replace(/\n/g, '\r\n') : out);
      return 'Edited ' + f;
    },
  },
  {
    name: 'search_files',
    description: 'List files in a folder, or search file contents with a regex (grep).',
    parameters: obj({ path: { type: 'string', description: 'folder, default workspace' }, pattern: { type: 'string', description: 'regex to search for in contents (optional)' } }),
    async run(a, c) { return searchFiles(abs(String(a.path ?? '.'), c.cwd), a.pattern ? String(a.pattern) : null); },
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
    description: 'Read a web page for free: returns the main content as Markdown, plus its links. Use browser_* tools for pages that need login or JavaScript.',
    parameters: obj({ url: { type: 'string' }, links: { type: 'boolean', description: 'also list links found on the page' } }, ['url']),
    async run(a) {
      const p = await fetchPage(String(a.url));
      return cap(`# ${p.title}\n\n${p.markdown}${a.links ? `\n\nLinks:\n${p.links.join('\n')}` : ''}`, 15000);
    },
  },
  {
    name: 'transcribe', ask: 'Transcribe a recording on your computer (installs Whisper once)',
    description: 'Turn an audio or video file (meeting, call, voice note) into a timestamped transcript with Whisper, fully on this computer. Saves <file>.transcript.txt next to it and returns the text. Use before writing meeting notes.',
    parameters: obj({ path: { type: 'string' }, language: { type: 'string', description: 'ISO code like en or hi; default auto-detect' } }, ['path']),
    async run(a, c) {
      const f = abs(String(a.path), c.cwd);
      const t = await transcribeFile(f, { language: a.language ? String(a.language) : undefined });
      const text = transcriptText(t);
      const saved = `${f}.transcript.txt`;
      fs.writeFileSync(saved, text);
      return `Language ${t.language}, ${stamp(t.duration)} long. Saved to ${saved}\n\n${cap(text, 30000)}`;
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
export const botHome = (botId: string) => path.join(os.homedir(), '.openkrishbot', 'bots', botId);
