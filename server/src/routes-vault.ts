import { Hono } from 'hono';
import { requireUser, type AuthVars } from './lib/auth.js';
import { listVault, removeSecret, saveSecret } from './vault.js';

/** /api/vault: names and settings only. Values go in, never come back out. */
export const vaultApi = new Hono<AuthVars>();
vaultApi.use('*', requireUser);
vaultApi.get('/', (c) => c.json({ items: listVault(c.get('user').id) }));
vaultApi.put('/', async (c) => {
  const r = saveSecret(c.get('user').id, await c.req.json().catch(() => ({})));
  return 'error' in r ? c.json({ error: r.error }, 400) : c.json({ item: r });
});
vaultApi.delete('/:name', (c) => (removeSecret(c.get('user').id, c.req.param('name')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));
