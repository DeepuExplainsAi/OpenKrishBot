import { homedir } from "node:os";
export const userHome = (env: Record<string, string | undefined> = process.env): string =>
  process.platform === "win32" ? env.USERPROFILE || env.HOME || homedir() : env.HOME || env.USERPROFILE || homedir();
