import { releaseBotIssues } from './issues.js';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db, now } from './db.js';
import { env } from './env.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createSession, destroySession, isLocalHost, isLoopbackAddress, isOwnerKey, requireUser, userFromCookieHeader, type AuthVars } from './lib/auth.js';
import { allLive, appendRow, clearConversation, emitBot, getBot, getBotRow, getRow, listBots, listRoutines, listRows, listTasks, toRoutine, toTask, updateRow } from './store.js';
import { cancelQueued, enqueue, interrupt, pauseQueue, queueView, resolveApproval, resumeQueue } from './agent/loop.js';
import { computerState, ensureComputer, forgetBotFiles, refreshComputer, releaseScreen, suspendComputer } from './computer.js';
import { assignEngine, provisionEngine, removeEngine, syncPersona } from './engine.js';
import { deleteMemory, listMemories, memoryBot } from './engine-memory.js';
import { screenIfRunning } from './screen/manager.js';
import { SignInNeeded, addCustomApp, appInfo, connectCatalogApp, forgetAppTools, listApps, oauth, removeApp } from './apps.js';
import { runRoutine, scheduleRoutine, unscheduleRoutine } from './routines.js';
import { dispatchRoomMessage } from './agent/rooms.js';
import { voiceApi } from './voice.js';
import { conversationHtml } from './share.js';
import type { AvatarColor, AvatarShape, Toolkit } from './types.js';

export const api = new Hono<AuthVars>();

const SHAPES: AvatarShape[] = ['blob', 'pebble', 'bean', 'egg', 'squircle', 'tablet', 'capsule', 'cylinder', 'hex', 'gem', 'crystal', 'wedge', 'shield', 'dome', 'arch', 'cloud', 'teardrop', 'leaf', 'square', 'sparkle', 'clover', 'flower', 'heart', 'house', 'star'];
const COLORS: AvatarColor[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray'];

function hashPick<T>(id: string, list: T[]): T {
  let h = 0x811c9dc5;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return list[h % list.length];
}

/** JSON that is safe to embed inside an inline <script>: `<` can't close the tag and line separators can't break the statement. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Thrown for things the user can fix; the message is shown to them. */
class UserError extends Error {}

const agentCount = () => (db.prepare("SELECT COUNT(*) n FROM bots WHERE COALESCE(kind,'agent')<>'room' AND COALESCE(hidden,0)=0").get() as any).n as number;

export function createBot(userId: string, b: { name: string; label?: string; description?: string; instructions?: string; avatarShape?: string; avatarColor?: string; mode?: string; isPrimary?: boolean }) {
  // Every bot needs a screen of its own on the one shared computer.
  if (agentCount() >= env.maxBots) throw new UserError(`The team is full: the computer has room for ${env.maxBots} bots. Remove one to add another.`);
  const id = newId('bot');
  const shape = SHAPES.includes(b.avatarShape as AvatarShape) ? b.avatarShape : hashPick(id, SHAPES.slice(0, 13));
  const color = COLORS.includes(b.avatarColor as AvatarColor) ? b.avatarColor : hashPick(id, COLORS.filter((c) => c !== 'black'));
  db.prepare(
    'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, userId, b.name.trim().slice(0, 60) || 'New Bot', b.label ?? '', b.description ?? '', b.instructions ?? '', shape, color, b.mode === 'teammate' ? 'teammate' : 'personal', b.isPrimary ? 1 : 0, now(), now());
  // The first bot is the agent that already runs on the computer; the others get an engine of their own.
  if (assignEngine(id) === 'managed') provisionEngine(id);
  hub.emit(userId, { type: 'roster' });
  return getBot(id)!;
}

/**
 * Who may sign in. Every account gets agents with a shell on the shared computer, so on a public URL
 * only ALLOWED_EMAILS get in, and with an empty list nobody new does. `owner` (the key that only
 * exists on the server's machine) is always let in.
 */
function maySignIn(email: string, exists: boolean, owner: boolean): boolean {
  if (owner) return true;
  if (env.allowedEmails.length) return env.allowedEmails.includes(email.toLowerCase());
  return exists || env.localOnly;
}

function findOrCreateUser(email: string, name?: string, preferId?: string, opts: { owner?: boolean } = {}) {
  const existing = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email) as any;
  if (!maySignIn(email, !!existing, !!opts.owner)) throw new UserError('This account is not allowed to sign in here.');
  if (existing) return { id: existing.id as string, isNew: false };
  const id = preferId ?? newId('usr');
  db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run(id, email, name ?? email.split('@')[0], now());
  createBot(id, { name: env.primaryBotName, label: env.primaryBotLabel, description: 'Your main point of contact. Checks in proactively and coordinates work with your other Bots.', avatarShape: 'blob', avatarColor: 'black', isPrimary: true });
  return { id, isNew: true };
}

// ---------- auth ----------

api.get('/auth/me', (c) => {
  let user = userFromCookieHeader(c.req.header('cookie'));
  // Local app: a request from this machine is the owner. No sign-in screen, no cloud account.
  if (!user && env.autoLocalLogin && isLocalHost(c.req.header('host')) && isLoopbackAddress(getConnInfo(c).remote.address)) {
    const { id } = findOrCreateUser(env.ownerEmail, env.ownerName, undefined, { owner: true });
    createSession(c, id);
    user = { id, email: env.ownerEmail, name: env.ownerName, avatarUrl: null } as any;
  }
  return c.json({ user, devLogin: env.devLogin });
});

api.post('/auth/dev', async (c) => {
  // Email-only sign-in proves nothing about who is asking, so it only works for a local app and
  // only for requests from this machine (not, say, from the LAN when the server listens there).
  if (!env.devLogin || !isLoopbackAddress(getConnInfo(c).remote.address)) return c.json({ error: 'disabled' }, 403);
  const { email, name } = await c.req.json<{ email: string; name?: string }>();
  if (!email?.includes('@')) return c.json({ error: 'email required' }, 400);
  try {
    const { id } = findOrCreateUser(email, name);
    createSession(c, id);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e instanceof UserError ? e.message : 'could not sign in' }, 403);
  }
});

/** One-time sign-in links made by the owner endpoint. Kept in memory: a restart drops them. */
const signInLinks = new Map<string, { userId: string; expires: number }>();

// Sign-in for whoever runs the server, without Google: the key only exists on the machine (see isOwnerKey).
// With `link`, it answers with a link that signs one browser in, once (scripts/sign-in-link.sh).
api.post('/auth/owner', async (c) => {
  if (!isOwnerKey((c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, ''))) return c.json({ error: 'forbidden' }, 403);
  const { email, name, link } = await c.req.json<{ email: string; name?: string; link?: boolean }>();
  if (!email?.includes('@')) return c.json({ error: 'email required' }, 400);
  try {
    const { id } = findOrCreateUser(email, name, undefined, { owner: true });
    if (link) {
      const token = crypto.randomBytes(24).toString('base64url');
      signInLinks.set(token, { userId: id, expires: Date.now() + 15 * 60_000 });
      return c.json({ ok: true, url: `${env.appUrl}/api/auth/link/${token}` });
    }
    createSession(c, id);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e instanceof UserError ? e.message : 'could not sign in' }, 403);
  }
});

api.get('/auth/link/:token', (c) => {
  const token = c.req.param('token');
  const l = signInLinks.get(token);
  signInLinks.delete(token);
  if (!l || l.expires < Date.now()) return c.text('This sign-in link was already used or has expired. Ask for a new one.', 410);
  createSession(c, l.userId);
  return c.redirect('/');
});

api.post('/auth/logout', (c) => { destroySession(c); return c.json({ ok: true }); });

// everything below requires a session
api.use('/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path.startsWith('/api/apps/callback') || c.req.path === '/api/health') return next();
  return requireUser(c, next);
});

// ---------- events (SSE) ----------

api.get('/events', (c) => {
  const user = c.get('user');
  return streamSSE(c, async (stream) => {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const unsub = hub.subscribe(user.id, (ev) => { queue.push(JSON.stringify(ev)); wake?.(); });
    stream.onAbort(() => { unsub(); wake?.(); });
    await stream.writeSSE({ data: JSON.stringify({ type: 'hello', serverTime: now() }) });
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), new Promise((r) => setTimeout(r, 20_000))]);
        wake = null;
        if (!queue.length) { await stream.writeSSE({ data: JSON.stringify({ type: 'ping' }) }); continue; }
      }
      while (queue.length) await stream.writeSSE({ data: queue.shift()! });
    }
    unsub();
  });
});

// ---------- bots ----------

const ownBot = (userId: string, id: string) => {
  const b = getBotRow(id);
  return b && b.user_id === userId ? b : null;
};

api.get('/bots', (c) => c.json({ bots: listBots(c.get('user').id), live: allLive(c.get('user').id) }));

api.post('/bots', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid JSON body' }, 400);
  try {
    return c.json({ bot: createBot(c.get('user').id, body) });
  } catch (e: any) {
    if (e instanceof UserError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

api.patch('/bots/:id', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const p = await c.req.json().catch(() => null);
  if (!p || typeof p !== 'object') return c.json({ error: 'invalid JSON body' }, 400);
  const cols: Record<string, string> = { name: 'name', label: 'label', description: 'description', instructions: 'instructions', avatarShape: 'avatar_shape', avatarColor: 'avatar_color', mode: 'mode', effort: 'effort', pinned: 'pinned', archived: 'archived', avatarImage: 'avatar_image', unread: 'unread', voice: 'voice', voiceSpeed: 'voice_speed', voiceLanguage: 'voice_language' };
  if (p.avatarImage !== undefined && p.avatarImage !== null && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]{20,120000}$/.test(p.avatarImage)) return c.json({ error: 'The picture must be a small PNG, JPEG or WebP.' }, 400);
  for (const [k, col] of Object.entries(cols)) {
    if (p[k] !== undefined) db.prepare(`UPDATE bots SET ${col}=?, updated_at=? WHERE id=?`).run(typeof p[k] === 'boolean' ? (p[k] ? 1 : 0) : p[k], now(), b.id);
  }
  if (b.kind !== 'room') {
    if (['name', 'label', 'description'].some((k) => p[k] !== undefined)) syncPersona(b.id);
  }
  emitBot(b.id);
  return c.json({ bot: getBot(b.id) });
});

api.delete('/bots/:id', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  interrupt(b.id);
  for (const r of listRoutines(b.id)) {
    unscheduleRoutine(r.id);
  }
  if (b.kind !== 'room') {
    await removeEngine(b.id).catch((e) => console.warn('[engine] remove failed', e?.message ?? e));
    await releaseScreen(b.id).catch((e) => console.warn('[computer] release failed', e?.message ?? e));
    await forgetBotFiles(b.id).catch((e) => console.warn('[computer] cleanup failed', e?.message ?? e));
  }
  db.prepare('DELETE FROM screens WHERE bot_id=?').run(b.id);
  db.prepare('DELETE FROM bots WHERE id=?').run(b.id);
  releaseBotIssues(b.id);
  hub.emit(c.get('user').id, { type: 'roster' });
  return c.json({ ok: true });
});

/** A copy with the same job and engine settings but an empty conversation. */
api.post('/bots/:id/duplicate', (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b || b.kind === 'room') return c.json({ error: 'not found' }, 404);
  try {
    const copy = createBot(user.id, { name: `${b.name} copy`, label: b.label, description: b.description, instructions: b.instructions, avatarShape: b.avatar_shape, avatarColor: b.avatar_color, mode: b.mode });
    db.prepare('UPDATE bots SET project_id=?, effort=?, model=?, provider=? WHERE id=?').run(b.project_id ?? null, b.effort, b.model, b.provider, copy.id);
    emitBot(copy.id);
    return c.json({ bot: getBot(copy.id) });
  } catch (e: any) {
    if (e instanceof UserError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

api.post('/bots/:id/primary', (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  db.prepare('UPDATE bots SET is_primary = (id = ?) WHERE user_id=?').run(b.id, user.id);
  hub.emit(user.id, { type: 'roster' });
  return c.json({ ok: true });
});

api.post('/bots/:id/read', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  db.prepare('UPDATE bots SET unread=0 WHERE id=?').run(b.id);
  emitBot(b.id);
  return c.json({ ok: true });
});

// ---------- conversation ----------

api.get('/bots/:id/rows', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const beforeSeq = c.req.query('beforeSeq') ? Number(c.req.query('beforeSeq')) : undefined;
  return c.json({ generation: b.generation, rows: listRows(b.id, { beforeSeq, limit: Number(c.req.query('limit') ?? 200) }) });
});

api.post('/bots/:id/messages', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { text } = await c.req.json<{ text?: unknown }>().catch(() => ({ text: undefined }));
  if (typeof text !== 'string' || !text.trim()) return c.json({ error: 'empty' }, 400);
  if (text.length > 60_000) return c.json({ error: 'message too long (max 60000 characters)' }, 413);
  const row = appendRow(b.id, 'message', { type: 'message', role: 'user', text: text.trim() });
  // Group chats dispatch to their member Bots instead of running their own loop.
  if (b.kind === 'room') dispatchRoomMessage(b.id, text.trim(), enqueue);
  // Any pending question card is answered by a free-text message.
  else enqueue(b.id, { type: 'user', text: text.trim() });
  return c.json({ row });
});

api.post('/bots/:id/interrupt', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  interrupt(b.id);
  return c.json({ ok: true });
});

api.get('/bots/:id/queue', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json(queueView(b.id)) : c.json({ error: 'not found' }, 404);
});

api.post('/bots/:id/queue/:action', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const action = c.req.param('action');
  if (action === 'pause') pauseQueue(b.id);
  else if (action === 'resume') resumeQueue(b.id);
  else if (action === 'cancel') cancelQueued(b.id, (await c.req.json().catch(() => ({}))).id);
  else return c.json({ error: 'unknown action' }, 400);
  hub.emit(c.get('user').id, { type: 'queue', botId: b.id });
  return c.json(queueView(b.id));
});

api.post('/bots/:id/fresh', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  interrupt(b.id);
  clearConversation(b.id);
  emitBot(b.id);
  return c.json({ ok: true });
});

api.post('/approvals/:id', async (c) => {
  const { decision, edit } = await c.req.json<{ decision: unknown; edit?: Record<string, unknown> }>().catch(() => ({ decision: undefined, edit: undefined }));
  if (decision !== 'allow' && decision !== 'always' && decision !== 'deny') return c.json({ error: 'decision must be allow, always or deny' }, 400);
  try { resolveApproval(c.get('user').id, c.req.param('id'), decision, edit && typeof edit === 'object' && !Array.isArray(edit) ? edit : undefined); } catch { return c.json({ error: 'not found' }, 404); }
  return c.json({ ok: true });
});

api.post('/bots/:id/cards/:seq/answer', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const row = getRow(b.id, Number(c.req.param('seq')));
  const { answer } = await c.req.json<{ answer?: unknown }>().catch(() => ({ answer: undefined }));
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 60_000) return c.json({ error: 'invalid answer' }, 400);
  if (!row || row.body.type !== 'card' || row.body.card !== 'question') return c.json({ error: 'not a question' }, 400);
  updateRow(b.id, row.seq, { ...row.body, status: 'answered', answer });
  appendRow(b.id, 'message', { type: 'message', role: 'user', text: answer });
  enqueue(b.id, { type: 'user', text: `[Answer to "${row.body.question}"] ${answer}` });
  return c.json({ ok: true });
});

api.post('/bots/:id/cards/:seq/dismiss', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const row = getRow(b.id, Number(c.req.param('seq')));
  if (!row || row.body.type !== 'card') return c.json({ error: 'not a card' }, 400);
  const body: any = { ...row.body, status: row.body.card === 'connect' ? 'skipped' : 'dismissed' };
  updateRow(b.id, row.seq, body);
  if (row.body.card === 'connect') enqueue(b.id, { type: 'system', text: `The user skipped connecting ${row.body.toolkitName}. Continue without it.` });
  return c.json({ ok: true });
});

// ---------- routines / tasks / memories ----------

api.get('/bots/:id/routines', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ routines: listRoutines(b.id) }) : c.json({ error: 'not found' }, 404);
});

api.patch('/routines/:id', async (c) => {
  const r = db.prepare('SELECT r.* FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.user_id=?').get(c.req.param('id'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  db.prepare('UPDATE routines SET enabled=? WHERE id=?').run(enabled ? 1 : 0, r.id);
  const next = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(r.id));
  enabled ? scheduleRoutine(next) : unscheduleRoutine(r.id);
  hub.emit(c.get('user').id, { type: 'routines', botId: r.bot_id });
  return c.json({ routine: next });
});

api.post('/routines/:id/run', (c) => {
  const r = db.prepare('SELECT r.* FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.user_id=?').get(c.req.param('id'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  runRoutine(r.id);
  return c.json({ ok: true });
});

api.delete('/routines/:id', async (c) => {
  const r = db.prepare('SELECT r.* FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.user_id=?').get(c.req.param('id'), c.get('user').id) as any;
  if (!r) return c.json({ error: 'not found' }, 404);
  unscheduleRoutine(r.id);
  db.prepare('DELETE FROM routines WHERE id=?').run(r.id);
  hub.emit(c.get('user').id, { type: 'routines', botId: r.bot_id });
  return c.json({ ok: true });
});

api.get('/bots/:id/tasks', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ tasks: listTasks(b.id) }) : c.json({ error: 'not found' }, 404);
});

/** Read-only snapshot of a conversation as one HTML file the user can send to anyone. */
api.get('/bots/:id/share', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const html = conversationHtml(b.name, listRows(b.id, { limit: 500 }));
  const file = `${String(b.name).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation'}.html`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${file}"`, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
});

api.get('/tasks', (c) => {
  const rows = db.prepare('SELECT t.* FROM tasks t JOIN bots b ON b.id=t.bot_id WHERE b.user_id=? ORDER BY t.updated_at DESC LIMIT 200').all(c.get('user').id) as any[];
  return c.json({ tasks: rows.map(toTask) });
});

api.get('/bots/:id/memories', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ memories: listMemories(b.id) });
});

api.delete('/memories/:id', (c) => {
  const botId = memoryBot(c.req.param('id'));
  if (!botId || !ownBot(c.get('user').id, botId)) return c.json({ error: 'not found' }, 404);
  deleteMemory(c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- computer ----------

api.get('/computer', async (c) => c.json({ computer: await refreshComputer(c.get('user').id) }));

api.post('/computer/ensure', (c) => {
  const userId = c.get('user').id;
  ensureComputer(userId).catch((e) => console.warn('[computer] ensure failed', e.message));
  return c.json({ computer: computerState(userId) });
});

api.post('/computer/suspend', async (c) => {
  await suspendComputer(c.get('user').id);
  return c.json({ computer: computerState(c.get('user').id) });
});

api.get('/bots/:id/screenshot', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const live = screenIfRunning(b.id);
  if (!live) return c.body(null, 204);
  try {
    const f = await live.shot();
    return c.body(f.jpeg, 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  } catch {
    return c.body(null, 204);
  }
});

// ---------- apps: MCP servers and web APIs on this computer ----------

api.get('/apps', (c) => {
  const search = (c.req.query('search') ?? '').toLowerCase();
  const category = c.req.query('category') ?? '';
  const all = listApps();
  let items: Toolkit[] = all;
  if (search) items = items.filter((t) => t.name.toLowerCase().includes(search) || t.slug.includes(search) || t.description?.toLowerCase().includes(search));
  if (category) items = items.filter((t) => t.categories.some((x) => x.toLowerCase() === category.toLowerCase()));
  const connectedApps = all.filter((t) => t.connected);
  return c.json({ apps: items, connected: connectedApps.map((t) => t.slug), connectedApps, categories: [...new Set(all.flatMap((t) => t.categories))].sort(), total: items.length });
});

/** After an app is connected, the bot that asked continues. */
function afterConnect(userId: string, slug: string, botId?: string, seq?: number) {
  forgetAppTools();
  hub.emit(userId, { type: 'connections' });
  if (!botId || !getBotRow(botId)) return;
  if (seq) {
    const row = getRow(botId, seq);
    if (row?.body.type === 'card' && row.body.card === 'connect') updateRow(botId, seq, { ...row.body, status: 'connected' });
  }
  enqueue(botId, { type: 'system', text: `The user connected ${appInfo(slug)?.name ?? slug}. Continue with what you were doing.` });
}

/** Search the official MCP registry (thousands of servers). Each hit is turned into something addCustomApp can start on this computer. */
api.get('/apps/registry', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ results: [] });
  try {
    const res = await fetch(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=40&version=latest`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`registry answered ${res.status}`);
    const data: any = await res.json();
    const results = (data.servers ?? []).map((x: any) => x.server).flatMap((s: any) => {
      const base = { id: s.name as string, name: String(s.title || s.name).split('/').pop(), description: String(s.description ?? '').slice(0, 160) };
      const pkg = (s.packages ?? []).find((p: any) => (p.registryType === 'npm' || p.registryType === 'pypi') && (p.transport?.type ?? 'stdio') === 'stdio');
      if (pkg) {
        const env = (pkg.environmentVariables ?? []).map((e: any) => ({ key: e.name, label: e.description || e.name, secret: !!e.isSecret }));
        return [{ ...base, command: pkg.registryType === 'npm' ? 'npx' : 'uvx', args: pkg.registryType === 'npm' ? ['-y', pkg.identifier] : [pkg.identifier], env }];
      }
      const rem = (s.remotes ?? []).find((r: any) => r.type === 'streamable-http');
      if (rem) return [{ ...base, url: rem.url as string, headers: (rem.headers ?? []).map((h: any) => ({ key: h.name, label: h.description || h.name, secret: !!h.isSecret })) }];
      return [];
    });
    return c.json({ results });
  } catch (e: any) { return c.json({ error: `Couldn’t reach the MCP registry (${e.message}). Check your internet connection.` }, 502); }
});

api.post('/apps/custom', async (c) => {
  const a = await c.req.json<any>().catch(() => ({}));
  try { await addCustomApp(a); } catch (e: any) {
    if (e instanceof SignInNeeded) return signIn(c, e.slug, e.url);
    return c.json({ error: e.message }, 400);
  }
  afterConnect(c.get('user').id, '');
  return c.json({ ok: true });
});

/** The hosted server wants a sign-in: start OpenMausBot's OAuth flow; the page opens `authorizationUrl` and polls /apps/:slug/signin/:flowId. */
async function signIn(c: any, slug: string, url: string) {
  try {
    const st = await oauth.start(slug, url, null, 'loopback', { remote: false });
    return c.json({ signIn: st });
  } catch (e: any) { return c.json({ error: String(e?.message ?? e) }, 400); }
}
api.get('/apps/:slug/signin/:flowId', (c) => {
  const st = oauth.status(c.req.param('slug'), c.req.param('flowId'));
  return st ? c.json({ signIn: st }) : c.json({ error: 'No such sign-in.' }, 404);
});

api.post('/apps/:slug/connect', async (c) => {
  const slug = c.req.param('slug');
  const { values, botId, seq } = await c.req.json<{ values?: Record<string, string>; botId?: string; seq?: number }>().catch(() => ({} as any));
  try { await connectCatalogApp(slug, values ?? {}); } catch (e: any) {
    if (e instanceof SignInNeeded) return signIn(c, slug, e.url);
    return c.json({ error: e.message }, 400);
  }
  afterConnect(c.get('user').id, slug, botId, seq);
  return c.json({ ok: true });
});

api.delete('/apps/:slug', async (c) => {
  await removeApp(c.req.param('slug'));
  forgetAppTools();
  hub.emit(c.get('user').id, { type: 'connections' });
  return c.json({ ok: true });
});

api.get('/policies', (c) => c.json({ policies: db.prepare('SELECT tool, mode FROM policies WHERE user_id=?').all(c.get('user').id) }));
api.delete('/policies/:tool', (c) => {
  db.prepare('DELETE FROM policies WHERE user_id=? AND tool=?').run(c.get('user').id, c.req.param('tool'));
  return c.json({ ok: true });
});

api.route('/voice', voiceApi);
