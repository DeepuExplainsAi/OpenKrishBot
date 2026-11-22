// nod's /api/memory routes (server/personal.ts) on Hono.
import { Hono } from 'hono';
import { memory } from './nod-memory.ts';
import { memoryFileName, memoryMarkdown } from './shared-nod/memory-export.ts';

export const memoryApi = new Hono();

const fail = (c: any, e: any) => c.json({ error: e?.message ?? String(e) }, e?.statusCode ?? (e?.name === 'ZodError' ? 400 : 500));
const body = (c: any) => c.req.json().catch(() => ({}));
const notePath = (c: any) => `${c.req.param('area')}/${c.req.param('slug')}`;
const changed = async (c: any, change: Promise<unknown>) => {
  try {
    const result = await change;
    return c.json({ ...(await memory.view()), ...(typeof result === 'string' ? { path: result } : {}) });
  } catch (e) { return fail(c, e); }
};

memoryApi.get('/', async (c) => c.json(await memory.view()));
memoryApi.get('/export', async (c) => {
  const now = new Date();
  return c.body(memoryMarkdown(await memory.view(), now), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${memoryFileName(now)}"`,
  });
});
memoryApi.patch('/', async (c) => changed(c, memory.settings(await body(c))));
memoryApi.post('/notes', async (c) => changed(c, memory.add(await body(c))));
memoryApi.post('/import', async (c) => {
  try {
    const { saved: _s, ...imported } = await memory.importNotes(await body(c));
    return c.json({ ...(await memory.view()), imported });
  } catch (e) { return fail(c, e); }
});
memoryApi.patch('/notes/:area/:slug', async (c) => changed(c, memory.change(notePath(c), await body(c))));
memoryApi.delete('/notes/:area/:slug', (c) => changed(c, memory.forget(notePath(c))));
memoryApi.post('/notes/:area/:slug/archive', (c) => changed(c, memory.archiveNote(notePath(c))));
memoryApi.post('/archive/restore', async (c) => changed(c, memory.restore(await body(c))));
memoryApi.post('/archive/forget', async (c) => changed(c, memory.forgetArchived(await body(c))));
