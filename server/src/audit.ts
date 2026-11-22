import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { readAudit } from './danger.js';

export const auditApi = new Hono<AuthVars>();
auditApi.use('*', requireUser);
auditApi.get('/', (c) => c.json({ entries: readAudit(200) }));
