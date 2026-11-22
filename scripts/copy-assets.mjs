import { cpSync, readdirSync } from 'node:fs';

cpSync('src/maus/server/model-catalog/models-dev.snapshot.json', 'dist/maus/server/model-catalog/models-dev.snapshot.json');
for (const f of readdirSync('src/shared-nod').filter((n) => /\.d?\.?mts$|\.mjs$/.test(n))) cpSync(`src/shared-nod/${f}`, `dist/shared-nod/${f}`);
