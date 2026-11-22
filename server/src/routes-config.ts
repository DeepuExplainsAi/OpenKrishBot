import { Hono } from 'hono';
import { db, now } from './db.js';
import './db-config.js';
import { disableScripts, enableScripts, scriptsEnabled } from './scripts-api.js';
import { newId } from './lib/ids.js';
import { hub } from './lib/hub.js';
import { requireUser, type AuthVars } from './lib/auth.js';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { env } from './env.js';
import { libraryRoot } from './paths.js';
import { emitBot, getBotRow, listRoutines, listTasks } from './store.js';
import { LANGUAGES, getLanguage, setLanguage } from './language.js';
import { computerState, readyScreen, resetBotScreen } from './computer.js';
import { box } from './box.js';
import { engineHome, engineInfo, engineKind, forgetEngineOptions, restartEngine, stopOwnScreen } from './engine.js';
import { listMemories } from './engine-memory.js';
import { importFromGithub, installSkill, isEnabled, loadAll, removeSkill, setEnabled } from './skill-library.js';
import { costOf, getBudget, getPrice, setBudget, setPrice, usageSummary, usageToday } from './usage.js';
import type { LibraryFile, Skill } from './types.js';

/**
 * Bot settings, skills, library, computer controls and memory maintenance.
 * Mounted next to routes.ts in index.ts; every path here needs a signed-in user.
 */
export const configApi = new Hono<AuthVars>();

for (const p of ['/bots/*', '/skills/*', '/computer/*']) configApi.use(p, requireUser);

const ownBot = (userId: string, id: string) => {
  const b = getBotRow(id);
  return b && b.user_id === userId ? b : null;
};

const toSkill = (s: any): Skill => ({ id: s.id, botId: s.bot_id, name: s.name, description: s.description ?? '', body: s.body, createdAt: s.created_at, updatedAt: s.updated_at ?? s.created_at });
const listSkills = (botId: string) => (db.prepare('SELECT * FROM skills WHERE bot_id=? ORDER BY created_at ASC').all(botId) as any[]).map(toSkill);

// ---------- settings bundle ----------

configApi.get('/bots/:id/settings', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({
    memories: listMemories(b.id),
    skills: listSkills(b.id),
    routines: listRoutines(b.id),
    tasks: listTasks(b.id),
    // The agent keeps its own memory and trims its own context; there is nothing for the app to maintain.
    memory: { lastConsolidatedAt: null, historyChars: 0, compactAtChars: 0, lastCompaction: null },
  });
});

// ---------- skills ----------

function cleanSkill(p: any, partial = false): { name?: string; description?: string; body?: string } | string {
  const out: { name?: string; description?: string; body?: string } = {};
  if (p.name !== undefined || !partial) {
    const name = String(p.name ?? '').trim();
    if (!name) return 'Give the skill a name';
    out.name = name.slice(0, 80);
  }
  if (p.body !== undefined || !partial) {
    const body = String(p.body ?? '').trim();
    if (!body) return 'Write the steps for this skill';
    out.body = body.slice(0, 20_000);
  }
  if (p.description !== undefined) out.description = String(p.description).trim().slice(0, 300);
  return out;
}

configApi.get('/bots/:id/skills', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ skills: listSkills(b.id) }) : c.json({ error: 'not found' }, 404);
});

configApi.post('/bots/:id/skills', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const s = cleanSkill(await c.req.json().catch(() => ({})));
  if (typeof s === 'string') return c.json({ error: s }, 400);
  const id = newId('skl');
  db.prepare('INSERT INTO skills(id,bot_id,name,body,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, b.id, s.name, s.body, s.description ?? '', now(), now());
  return c.json({ skill: toSkill(db.prepare('SELECT * FROM skills WHERE id=?').get(id)) });
});

const ownSkill = (userId: string, id: string) =>
  db.prepare('SELECT s.* FROM skills s JOIN bots b ON b.id=s.bot_id WHERE s.id=? AND b.user_id=?').get(id, userId) as any;

configApi.patch('/skills/:id', async (c) => {
  const cur = ownSkill(c.get('user').id, c.req.param('id'));
  if (!cur) return c.json({ error: 'not found' }, 404);
  const s = cleanSkill(await c.req.json().catch(() => ({})), true);
  if (typeof s === 'string') return c.json({ error: s }, 400);
  db.prepare('UPDATE skills SET name=?, body=?, description=?, updated_at=? WHERE id=?').run(s.name ?? cur.name, s.body ?? cur.body, s.description ?? cur.description ?? '', now(), cur.id);
  return c.json({ skill: toSkill(db.prepare('SELECT * FROM skills WHERE id=?').get(cur.id)) });
});

configApi.delete('/skills/:id', (c) => {
  const cur = ownSkill(c.get('user').id, c.req.param('id'));
  if (!cur) return c.json({ error: 'not found' }, 404);
  db.prepare('DELETE FROM skills WHERE id=?').run(cur.id);
  return c.json({ ok: true });
});

// ---------- memory maintenance (now the agent's own job; kept so older clients get an answer) ----------

configApi.post('/bots/:id/memories/consolidate', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ added: [], skipped: 0, considered: 0 });
});

configApi.post('/bots/:id/compact', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ itemsBefore: 0, itemsAfter: 0, compacted: false });
});

// ---------- the agent behind a bot: model, sign-in, restart ----------

configApi.get('/bots/:id/engine', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json({ engine: await engineInfo(b.id) });
});

/** Which model this bot's turns ask for. Empty values go back to the agent's own default. */
configApi.patch('/bots/:id/engine', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const p = await c.req.json<{ provider?: string | null; model?: string | null }>().catch(() => ({} as { provider?: string | null; model?: string | null }));
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  if (p.provider !== undefined) db.prepare('UPDATE bots SET provider=?, updated_at=? WHERE id=?').run(clean(p.provider), now(), b.id);
  if (p.model !== undefined) db.prepare('UPDATE bots SET model=?, updated_at=? WHERE id=?').run(clean(p.model), now(), b.id);
  emitBot(b.id);
  return c.json({ engine: await engineInfo(b.id) });
});

/** Local scripts: GET state, POST creates a new token (shown once), DELETE turns it off. */
configApi.get('/bots/:id/scripts', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ enabled: scriptsEnabled(b.id) }) : c.json({ error: 'not found' }, 404);
});
configApi.post('/bots/:id/scripts', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  return b ? c.json({ enabled: true, token: enableScripts(b.id) }) : c.json({ error: 'not found' }, 404);
});
configApi.delete('/bots/:id/scripts', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  disableScripts(b.id);
  return c.json({ enabled: false });
});

configApi.get('/bots/:id/budget', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  return c.json(budgetInfo(b.id));
});

function budgetInfo(botId: string) {
  const today = usageToday(botId);
  const price = getPrice(botId);
  return { dailyTokens: getBudget(botId), today: { ...today, costUsd: costOf(price, today.tokensIn, today.tokensOut) }, price };
}

/** { inPerM, outPerM } USD per million tokens, or null: what this bot's model costs, so Today shows money. */
configApi.put('/bots/:id/price', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const p = await c.req.json<any>().catch(() => null);
  if (p !== null && !(Number.isFinite(p?.inPerM) && Number.isFinite(p?.outPerM) && p.inPerM >= 0 && p.outPerM >= 0 && p.inPerM <= 10_000 && p.outPerM <= 10_000)) return c.json({ error: 'Prices are USD per million tokens, between 0 and 10000.' }, 400);
  setPrice(b.id, p);
  return c.json(budgetInfo(b.id));
});

/** { dailyTokens: number | null }: a daily token cap for this bot; null or 0 removes it. */
configApi.put('/bots/:id/budget', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { dailyTokens } = await c.req.json<{ dailyTokens?: number | null }>().catch(() => ({} as { dailyTokens?: number | null }));
  if (dailyTokens !== null && dailyTokens !== undefined && !(Number.isFinite(dailyTokens) && dailyTokens >= 0)) return c.json({ error: 'dailyTokens must be a number.' }, 400);
  setBudget(b.id, dailyTokens ?? null);
  return c.json(budgetInfo(b.id));
});

configApi.get('/skill-library', (c) => c.json({ skills: loadAll().map((s) => ({ id: s.id, name: s.name, description: s.description, triggers: s.triggerTerms.slice(0, 6), custom: !!s.custom, enabled: isEnabled(s) })) }));
configApi.put('/skill-library/:id', async (c) => {
  const s = loadAll().find((x) => x.id === c.req.param('id'));
  if (!s) return c.json({ error: 'not found' }, 404);
  const { enabled } = await c.req.json<{ enabled?: boolean }>().catch(() => ({} as { enabled?: boolean }));
  setEnabled(s.id, enabled !== false);
  return c.json({ id: s.id, enabled: isEnabled(s) });
});

configApi.post('/skill-library/import', async (c) => {
  const { url, markdown } = await c.req.json<{ url?: string; markdown?: string }>().catch(() => ({} as { url?: string; markdown?: string }));
  try { const s = markdown ? installSkill(String(markdown)) : await importFromGithub(String(url ?? '')); return c.json({ id: s.id, name: s.name }); }
  catch (e: any) { return c.json({ error: e.message }, 400); }
});
configApi.delete('/skill-library/:id', (c) => removeSkill(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Only skills you added can be removed.' }, 404));

configApi.get('/usage', (c) => c.json({ usage: usageSummary(c.get('user').id, 7) }));

configApi.post('/bots/:id/engine/restart', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  // The primary agent serves more than this app (its messaging runs through the same process), so it is never restarted from here.
  if (engineKind(b.id) !== 'managed') return c.json({ error: `${b.name} runs on the computer's own agent, which this app does not restart.` }, 409);
  try {
    await restartEngine(b.id);
    forgetEngineOptions(b.id);
    return c.json({ engine: await engineInfo(b.id) });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502);
  }
});

/** Stop the private screen Hermes runs for this agent, so its computer work comes back to the screen shown here. */
configApi.post('/bots/:id/engine/screen/stop', async (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  try {
    await stopOwnScreen(b.id);
    return c.json({ engine: await engineInfo(b.id) });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 409);
  }
});

/** The user gives the screen back after taking control; the bot is told on its next turn. */
configApi.post('/bots/:id/handback', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  db.prepare('UPDATE bots SET handback_at=? WHERE id=?').run(now(), b.id);
  return c.json({ ok: true });
});

// ---------- library: files under <libraryRoot>/<botId> on the bot's computer (see paths.ts) ----------

function safeRel(p: string | undefined): string | null {
  const rel = (p ?? '').replace(/^\/+|\/+$/g, '');
  if (!rel) return '';
  if (rel.split('/').some((s) => !s || s === '.' || s === '..') || /[\0\n\r]/.test(rel)) return null;
  return rel;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Parse `ls -la --time-style=+%s` output. */
export function parseLs(out: string): LibraryFile[] {
  const files: LibraryFile[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^([-dlcbps])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    let name = m[4];
    if (m[1] === 'l') name = name.replace(/ -> .*$/, '');
    if (name === '.' || name === '..') continue;
    files.push({ name, size: Number(m[2]), modifiedAt: Number(m[3]) * 1000, isDir: m[1] === 'd' });
  }
  return files.sort((a, b) => Number(b.isDir) - Number(a.isDir) || b.modifiedAt - a.modifiedAt);
}

configApi.get('/bots/:id/files', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (rel === null) return c.json({ error: 'bad path' }, 400);
  try {
    const dir = `${libraryRoot()}/${b.id}${rel ? `/${rel}` : ''}`;
    const r = await box.bash(`mkdir -p ${shq(`${libraryRoot()}/${b.id}`)} && ls -la --time-style=+%s ${shq(dir)} 2>&1`, 30);
    if (r.exit_code !== 0) return c.json({ status: 'error', path: rel, files: [], error: (r.output ?? '').slice(0, 300) });
    return c.json({ status: 'ok', path: rel, files: parseLs(r.output ?? '') });
  } catch (e: any) {
    return c.json({ status: 'error', path: rel, files: [], error: String(e?.message ?? e).slice(0, 300) });
  }
});

configApi.post('/bots/:id/files/download', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const { path } = await c.req.json<{ path: string }>().catch(() => ({ path: '' }));
  const rel = safeRel(path);
  if (!rel) return c.json({ error: 'bad path' }, 400);
  return c.json({ url: `/api/bots/${b.id}/files/raw?path=${encodeURIComponent(rel)}` });
});

configApi.get('/bots/:id/files/raw', (c) => {
  const b = ownBot(c.get('user').id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  const rel = safeRel(c.req.query('path'));
  if (!rel) return c.json({ error: 'bad path' }, 400);
  const root = `${libraryRoot()}/${b.id}`;
  let file: string;
  try {
    // Follow links before checking, so a link inside the library cannot point outside it.
    file = fs.realpathSync(`${root}/${rel}`);
    if (!file.startsWith(fs.realpathSync(root) + '/') || !fs.statSync(file).isFile()) throw new Error('outside');
  } catch {
    return c.json({ error: 'not found' }, 404);
  }
  const name = rel.split('/').pop()!;
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(fs.statSync(file).size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'x-content-type-options': 'nosniff',
    },
  });
});

// ---------- computer: screens, reset, hibernation ----------

configApi.get('/language', (c) => c.json({ language: getLanguage(), languages: LANGUAGES }));
configApi.put('/language', async (c) => {
  const { language } = await c.req.json<{ language?: string }>().catch(() => ({ language: undefined }));
  if (language !== 'auto' && !(LANGUAGES as readonly string[]).includes(language ?? '')) return c.json({ error: 'unknown language' }, 400);
  setLanguage(language!);
  return c.json({ language });
});

configApi.get('/computer/details', (c) => {
  const userId = c.get('user').id;
  const leases = db.prepare('SELECT bot_id, screen_id, last_used_at FROM screens WHERE user_id=? ORDER BY last_used_at DESC').all(userId) as any[];
  return c.json({
    computer: computerState(userId),
    screens: leases.map((l) => ({ botId: l.bot_id, screenId: l.screen_id, lastUsedAt: l.last_used_at })),
  });
});

/** Give a bot a clean screen: close what is open and bring its browser back to its home screen. Logins stay. */
configApi.post('/bots/:id/screen/reset', async (c) => {
  const user = c.get('user');
  const b = ownBot(user.id, c.req.param('id'));
  if (!b) return c.json({ error: 'not found' }, 404);
  try {
    await resetBotScreen(user.id, b.id);
    hub.emit(user.id, { type: 'computer', state: computerState(user.id) });
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e).slice(0, 300) }, 502);
  }
});
