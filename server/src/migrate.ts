import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One-time move of data from the old Krishbot names to OpenKrishBot. Must run before anything opens the data folder. */
const rename = (from: string, to: string) => {
  try { if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to); } catch { /* keep the old file; the app starts fresh */ }
};
rename(path.join(os.homedir(), '.krishbot'), path.join(os.homedir(), '.openkrishbot'));
const data = fileURLToPath(new URL('../../data/', import.meta.url));
for (const ext of ['', '-wal', '-shm']) rename(`${data}bothq.db${ext}`, `${data}openkrishbot.db${ext}`);
