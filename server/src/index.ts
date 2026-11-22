import { auditApi } from './audit.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { compatEnv, env } from './env.js';
import { api } from './routes.js';
import { attachScreenRelay } from './screen/relay.js';
import { initRoutines } from './routines.js';
import { hooks } from './triggers.js';
import { pairRoute, phoneApi } from './phone.js';
import { initWhatsApp, whatsappApi } from './whatsapp.js';
import { initProactive } from './proactive.js';
import { initSubagents } from './agent/subagents.js';
import { initRooms } from './agent/rooms.js';
import { checkinsApi } from './routes-proactive.js';
import { roomsApi } from './routes-rooms.js';
import { enqueue, expireStaleApprovals } from './agent/loop.js';
import { configApi } from './routes-config.js';
import { mcpApi } from './mcp.js';
import { krishApi, providersApi } from './krish/engine.js';
import { initEngines } from './engine.js';
import { sameOriginWrites } from './lib/auth.js';

initSubagents();
initRooms();
// Approvals wait in memory; whatever was still open when the last process stopped can no longer be answered.
expireStaleApprovals();

const app = new Hono();
// Cookie-authenticated writes must come from the app's own pages (CSRF; see sameOriginWrites).
app.use('/api/*', sameOriginWrites);
app.get('/api/health', (c) => c.json({ ok: true, engine: 'krishbot' }));
// The app's tools for the agent engines (MCP).
app.route('/mcp', mcpApi);
app.route('/hooks', hooks);
app.route('/pair', pairRoute);
app.route('/api/phone', phoneApi);
app.route('/api/whatsapp', whatsappApi);
app.route('/api/audit', auditApi);
app.route('/krish', krishApi);
app.route('/api/krish', providersApi);
app.route('/api/checkins', checkinsApi);
app.route('/api/rooms', roomsApi);
app.route('/api', api);
app.route('/api', configApi);

// Serve the built web app in production.
const webDist = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get('*', (c) => c.html(fs.readFileSync(path.join(webDist, 'index.html'), 'utf8')));
}

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => console.log(`[bothq] server on http://localhost:${info.port}`));
attachScreenRelay(server as unknown as Server);
// BOTHQ_NO_SCHEDULER=1 for extra dev/test servers sharing a database copy, so routines and triggers don't fire twice.
if (compatEnv('NO_SCHEDULER') !== '1') {
  initRoutines(enqueue);
  initProactive(enqueue);
} else console.log('[bothq] scheduler disabled (BOTHQ_NO_SCHEDULER=1)');
initEngines();
initWhatsApp();
