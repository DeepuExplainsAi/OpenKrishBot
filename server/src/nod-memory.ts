import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './maus/server/config.js';
import { ObjectStoreConflict, type PrivateObjectStore } from './nod/object-storage.ts';
import { createMemoryService } from './nod/memory.ts';

const root = path.join(DATA_DIR, 'nod-memory');
const versionOf = (file: string) => String(fs.statSync(file).mtimeMs);

const store: PrivateObjectStore = {
  async read(key, maxBytes) {
    const file = path.join(root, key);
    if (!fs.existsSync(file)) return undefined;
    const bytes = fs.readFileSync(file);
    return bytes.length > maxBytes ? undefined : { bytes, version: versionOf(file) };
  },
  async write(key, bytes, { expectedVersion }) {
    const file = path.join(root, key);
    const exists = fs.existsSync(file);
    if ((exists ? versionOf(file) : null) !== expectedVersion) throw new ObjectStoreConflict();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return versionOf(file);
  },
  async remove(key) {
    fs.rmSync(path.join(root, key), { force: true });
  },
};

// Nod keeps message sources in Postgres; here notes carry no linked chat messages.
const pool = {
  async query(sql: string) {
    return sql.includes('to_char') ? { rows: [{ now: new Date().toISOString() }] } : { rows: [], rowCount: 0 };
  },
};

export const memory = createMemoryService({ pool, ownerId: 'owner', store });
