import { spawn } from 'node:child_process';

/** Open a terminal window on this computer running `cmd` (used for model sign-in). Resolves false if none could be opened. */
export function openTerminal(cmd: string): Promise<boolean> {
  const attempts: [string, string[]][] =
    process.platform === 'darwin' ? [['osascript', ['-e', `tell application "Terminal" to activate`, '-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`]]]
    : process.platform === 'win32' ? [['cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd]]]
    : [['x-terminal-emulator', ['-e', 'sh', '-c', `${cmd}; exec sh`]], ['gnome-terminal', ['--', 'sh', '-c', `${cmd}; exec sh`]], ['konsole', ['-e', 'sh', '-c', `${cmd}; exec sh`]], ['xterm', ['-e', 'sh', '-c', `${cmd}; exec sh`]]];
  return (async () => {
    for (const [bin, args] of attempts) {
      const ok = await new Promise<boolean>((resolve) => {
        const p = spawn(bin, args, { detached: true, stdio: 'ignore', shell: process.platform === 'win32' && false });
        p.once('error', () => resolve(false));
        p.once('spawn', () => { p.unref(); resolve(true); });
      });
      if (ok) return true;
    }
    return false;
  })();
}

export const quote = (s: string) => (process.platform === 'win32' ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`);
