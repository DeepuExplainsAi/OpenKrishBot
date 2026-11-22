// OpenMausBot's MCP servers screen backend (server/routes/mcp-servers.ts + host/mcp-config.ts), on a plain JSON file.
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { McpOAuthError, McpSignInError, withMcpSignIn } from './maus/server/mcp-oauth.ts';
import { isRemoteMcpServer, listMcpServers, mcpServerBody, mcpServerLimitError, mcpServerNotFound, parseMcpServerMutation, parseMcpServersImport, parseStoredMcpServer, type StoredMcpServer } from './maus/server/mcp-registry.ts';
import { probeMcpServer, type McpProbeResult } from './maus/server/mcp-probe.ts';
import { oauth, forgetAppTools, loadMcpServers, MCP_SERVERS_FILE as FILE } from './apps.js';

const NAME = '[a-z][a-z0-9_-]{0,31}';

const persist = (next: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  forgetAppTools();
};
const response = () => ({ servers: listMcpServers(loadMcpServers()).map((s) => (isRemoteMcpServer(s as any) ? { ...s, auth: oauth.authState(s.name, (s as any).url) } : s)) });

export const mcpApi = new Hono();

const stored = (name: string) => {
  const current = loadMcpServers();
  if (!Object.hasOwn(current, name)) return { error: mcpServerNotFound(name), status: 404 as const };
  const parsed = parseStoredMcpServer(name, current[name]);
  return parsed.ok ? { current, existing: parsed.server } : { error: parsed.error, status: 400 as const };
};

mcpApi.get('/servers', (c) => c.json(response()));

mcpApi.post('/servers', async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';
  const parsed = parseMcpServerMutation(name, mcpServerBody(body));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const current = loadMcpServers();
  if (Object.hasOwn(current, name)) return c.json({ error: 'An MCP server with that name already exists.' }, 409);
  const limit = mcpServerLimitError(current, [parsed.server]);
  if (limit) return c.json({ error: limit }, 400);
  persist({ ...current, [name]: parsed.server });
  return c.json(response(), 201);
});

// The {"mcpServers": {...}} block other agent tools write; imported servers stay disabled until enabled.
mcpApi.post('/servers/import', async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  const text = typeof body?.json === 'string' ? body.json : '';
  if (!text.trim()) return c.json({ error: 'Paste the JSON block first.' }, 400);
  const parsed = parseMcpServersImport(text);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const current = loadMcpServers();
  const names = Object.keys(parsed.servers);
  const taken = names.filter((n) => Object.hasOwn(current, n));
  if (taken.length) return c.json({ error: `Already added: ${taken.join(', ')}. Remove or rename ${taken.length === 1 ? 'it' : 'them'} first.` }, 409);
  const limit = mcpServerLimitError(current, Object.values(parsed.servers));
  if (limit) return c.json({ error: limit }, 400);
  persist({ ...current, ...parsed.servers });
  return c.json({ ...response(), added: names }, 201);
});

mcpApi.put(`/servers/:name{${NAME}}`, async (c) => {
  const name = c.req.param('name');
  const found = stored(name);
  if (!found.existing) return c.json({ error: found.error }, found.status as 404);
  const { vaultKeys: _k, ...fields } = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const parsed = parseMcpServerMutation(name, fields, found.existing);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  persist({ ...found.current, [name]: parsed.server });
  // A sign-in belongs to one address: a token never follows the entry elsewhere.
  const before = isRemoteMcpServer(found.existing) ? found.existing.url : null;
  const after = isRemoteMcpServer(parsed.server) ? parsed.server.url : null;
  if (before !== after || (after && oauth.authState(name, after) === 'needs-sign-in')) oauth.forget(name);
  return c.json(response());
});

mcpApi.patch(`/servers/:name{${NAME}}`, async (c) => {
  const name = c.req.param('name');
  const found = stored(name);
  if (!found.existing) return c.json({ error: found.error }, found.status as 404);
  const body: any = await c.req.json().catch(() => ({}));
  const key = body && typeof body === 'object' && Object.keys(body).length === 1 ? Object.keys(body)[0] : undefined;
  if ((key !== 'enabled' && key !== 'apps') || typeof body[key] !== 'boolean') return c.json({ error: 'Only an enabled or apps boolean can be changed here.' }, 400);
  if (key === 'enabled') persist({ ...found.current, [name]: { ...found.existing, enabled: body.enabled } });
  else { const { apps: _a, ...rest } = found.existing; persist({ ...found.current, [name]: { ...rest, ...(body.apps ? {} : { apps: false }) } }); }
  return c.json(response());
});

mcpApi.delete(`/servers/:name{${NAME}}`, (c) => {
  const name = c.req.param('name');
  const current = loadMcpServers();
  if (!Object.hasOwn(current, name)) return c.json({ error: mcpServerNotFound(name) }, 404);
  delete current[name];
  persist(current);
  oauth.forget(name);
  return c.json(response());
});

mcpApi.post(`/servers/:name{${NAME}}/test`, async (c) => {
  const name = c.req.param('name');
  const found = stored(name);
  if (!found.existing) return c.json({ error: found.error }, found.status as 404);
  let target: StoredMcpServer = found.existing;
  let sentSignIn = false;
  if (isRemoteMcpServer(target) && oauth.authState(name, target.url) === 'signed-in') {
    const signedIn = (await withMcpSignIn({ [name]: target }, oauth))[name];
    if (signedIn) { target = { ...signedIn, enabled: target.enabled } as typeof target; sentSignIn = true; }
  }
  const result: McpProbeResult = await probeMcpServer(target, undefined, c.req.raw.signal, { tryReadOnlyTool: true, ...(isRemoteMcpServer(target) ? {} : { asBot: {} }) });
  if (!result.ok && result.auth === 'required' && isRemoteMcpServer(target)) {
    if (sentSignIn) oauth.markNeedsSignIn(name, target.url); else oauth.requireSignIn(name, target.url);
  }
  return c.json(result);
});

mcpApi.all(`/servers/:name{${NAME}}/:action{sign-in|sign-out}/:flow?`, async (c) => {
  const name = c.req.param('name'), action = c.req.param('action'), flowId = c.req.param('flow'), method = c.req.method;
  const found = stored(name);
  if (!found.existing) return c.json({ error: found.error }, found.status as 404);
  if (!isRemoteMcpServer(found.existing)) return c.json({ error: 'Only servers reached by URL can be signed in to.' }, 400);
  const url = found.existing.url;
  c.header('Cache-Control', 'no-store');
  try {
    if (action === 'sign-out' && method === 'POST') { await oauth.signOut(name, url); return c.json(response()); }
    if (action === 'sign-in' && method === 'GET' && flowId) {
      const status = oauth.status(name, flowId, 'loopback');
      return status ? c.json({ auth: status }) : c.json({ error: 'This sign-in is no longer available. Start again.' }, 404);
    }
    if (action === 'sign-in' && method === 'DELETE') { oauth.cancelFlow(name, 'loopback', flowId); return c.json({ ok: true }); }
    if (action === 'sign-in' && method === 'POST' && flowId) {
      const body: any = await c.req.json().catch(() => ({}));
      if (typeof body?.callbackUrl !== 'string') return c.json({ error: 'A complete callbackUrl is required.' }, 400);
      return c.json({ auth: await oauth.completeCallback(name, flowId, body.callbackUrl, 'loopback') });
    }
    if (action === 'sign-in' && method === 'POST') return c.json({ auth: await oauth.start(name, url, undefined, 'loopback', { remote: false }) });
  } catch (e) {
    if (e instanceof McpSignInError) return c.json({ error: e.message }, e.status as 400);
    if (e instanceof McpOAuthError) return c.json({ error: e.message, code: e.code }, 400);
    return c.json({ error: e instanceof Error ? e.message : 'Sign-in could not start.' }, 502);
  }
  return c.json({ error: 'method not allowed' }, 405);
});
