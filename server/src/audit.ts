import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { getDangerMode, readAudit, setDangerMode } from './danger.js';

export const auditApi = new Hono<AuthVars>();
auditApi.use('*', requireUser);
auditApi.get('/', (c) => c.json({ entries: readAudit(200) }));

auditApi.get('/danger-mode', (c) => c.json({ mode: getDangerMode() }));
auditApi.put('/danger-mode', async (c) => {
  const { mode } = await c.req.json<{ mode?: string }>().catch(() => ({} as { mode?: string }));
  if (mode !== 'ask' && mode !== 'follow') return c.json({ error: 'mode must be ask or follow' }, 400);
  setDangerMode(mode);
  return c.json({ mode });
});
