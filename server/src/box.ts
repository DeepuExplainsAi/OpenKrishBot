import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/** The box is this computer: commands and files go straight to the local shell and disk. */

export interface BashResult { output: string; exit_code: number }

/** A path safe to put inside single quotes in a shell command. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const box = {
  local: true,

  bash(command: string, timeoutSec = 60): Promise<BashResult> {
    return new Promise((resolve) => {
      execFile('bash', ['-c', command], { timeout: timeoutSec * 1000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
        resolve({ output: `${stdout ?? ''}${stderr ?? ''}`, exit_code: code });
      });
    });
  },

  async writeFile(file: string, content: string | Buffer): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  },

  async readFile(file: string): Promise<Buffer | null> {
    try { return await fs.readFile(file); } catch { return null; }
  },

  quote: q,
};
