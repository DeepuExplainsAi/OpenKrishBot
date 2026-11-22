import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { createBot } from './routes.js';
import { exportCompany, importCompany } from './projects.js';
import { addFile, assignBot, createProject, deleteProject, listProjects, readFile, removeFile, updateProject } from './projects.js';

/** /api/projects: shared instructions and reference files for a group of bots. */
export const projectsApi = new Hono<AuthVars>();
projectsApi.use('*', requireUser);

const reply = (c: any, r: any) => (r === null ? c.json({ error: 'not found' }, 404) : 'error' in r ? c.json({ error: r.error }, 400) : c.json({ project: r }));
const body = (c: any) => c.req.json().catch(() => ({}));

projectsApi.get('/', (c) => c.json({ projects: listProjects(c.get('user').id) }));
projectsApi.post('/', async (c) => reply(c, createProject(c.get('user').id, await body(c))));
projectsApi.patch('/:id', async (c) => reply(c, updateProject(c.get('user').id, c.req.param('id'), await body(c))));
projectsApi.delete('/:id', (c) => (deleteProject(c.get('user').id, c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));
projectsApi.post('/:id/files', async (c) => reply(c, addFile(c.get('user').id, c.req.param('id'), await body(c))));
projectsApi.get('/:id/files/:fileId', (c) => { const f = readFile(c.get('user').id, c.req.param('id'), c.req.param('fileId')); return f ? c.json(f) : c.json({ error: 'not found' }, 404); });
projectsApi.delete('/:id/files/:fileId', (c) => (removeFile(c.get('user').id, c.req.param('id'), c.req.param('fileId')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));
/** PUT /api/projects/assign { botId, projectId|null } */
projectsApi.put('/assign', async (c) => {
  const b = await body(c);
  const err = assignBot(c.get('user').id, String(b.botId ?? ''), b.projectId || null);
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

projectsApi.get('/:id/export', (c) => {
  const d = exportCompany(c.get('user').id, c.req.param('id'));
  return d ? c.json(d, 200, { 'content-disposition': `attachment; filename="${d.name.replace(/[^\w.-]+/g, '_')}.company.json"` }) : c.json({ error: 'not found' }, 404);
});
projectsApi.post('/import', async (c) => {
  const userId = c.get('user').id;
  try { return reply(c, importCompany(userId, await body(c), (b) => createBot(userId, b).id)); }
  catch (e: any) { return c.json({ error: e.message }, 409); }
});
