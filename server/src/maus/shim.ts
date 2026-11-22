import { spawn, type ChildProcess } from "node:child_process";
export const spawnCli = (cli: string, args: string[], opts: Parameters<typeof spawn>[2]) => spawn(cli, args, { ...opts, windowsHide: true }) as ChildProcess & { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream };
export const killCliTree = async (child: ChildProcess, _timeoutMs = 5_000): Promise<boolean> => {
  try { child.kill(); } catch { /* gone */ }
  return child.exitCode !== null || child.killed;
};
