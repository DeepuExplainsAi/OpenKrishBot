import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';
import os from 'node:os';
import { db, now } from './db.js';
import { McpOAuthManager } from './maus/server/mcp-oauth.ts';
import { McpHttpError } from './maus/server/mcp-http.ts';
import { launchCommand, launchEnv } from './lib/launch.js';
import type { Toolkit } from './types.js';

/**
 * Connected apps run on this computer: ready-made MCP servers (started with npx, so Node.js must be
 * installed), MCP servers the user adds, and plain web APIs. Keys are typed in once and kept in the
 * local database. Nothing goes through a hosted service.
 */

db.exec(`CREATE TABLE IF NOT EXISTS apps (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'catalog' | 'mcp' | 'http'
  config TEXT NOT NULL,          -- JSON: catalog values, or the custom app's definition
  created_at INTEGER NOT NULL
)`);

interface Field { key: string; label: string; secret: boolean; kind: 'env' | 'arg' }
interface CatalogApp { slug: string; name: string; description: string; categories: string[]; command: string; args: string[]; fields: Field[]; url?: string }

const secret = (key: string, label: string): Field => ({ key, label, secret: true, kind: 'env' });
const npx = (pkg: string, ...rest: string[]) => ({ command: 'npx', args: ['-y', pkg, ...rest] });

export const CATALOG: CatalogApp[] = [
  { slug: 'browser', name: 'Browser', description: 'Open pages, click, type and read websites in a real browser.', categories: ['productivity', 'developer tools'], ...npx('@playwright/mcp@latest'), fields: [] },
  { slug: 'filesystem', name: 'Files', description: 'Read and edit files in a folder you choose.', categories: ['productivity', 'developer tools'], ...npx('@modelcontextprotocol/server-filesystem', '{folder}'), fields: [{ key: 'folder', label: 'Folder path', secret: false, kind: 'arg' }] },
  { slug: 'github', name: 'GitHub', description: 'Repos, issues and pull requests.', categories: ['developer tools'], ...npx('@modelcontextprotocol/server-github'), fields: [secret('GITHUB_PERSONAL_ACCESS_TOKEN', 'Personal access token')] },
  { slug: 'slack', name: 'Slack', description: 'Read and post messages in your Slack workspace.', categories: ['communication'], ...npx('@modelcontextprotocol/server-slack'), fields: [secret('SLACK_BOT_TOKEN', 'Bot token (xoxb-…)'), { key: 'SLACK_TEAM_ID', label: 'Team ID', secret: false, kind: 'env' }] },
  { slug: 'notion', name: 'Notion', description: 'Search and edit pages and databases.', categories: ['productivity'], ...npx('@notionhq/notion-mcp-server'), fields: [secret('NOTION_TOKEN', 'Integration token')] },
  { slug: 'docs', name: 'Code docs', description: 'Up-to-date documentation for libraries and frameworks.', categories: ['developer tools'], ...npx('@upstash/context7-mcp'), fields: [] },
  { slug: 'brave', name: 'Brave Search', description: 'Web search with a free API key.', categories: ['productivity'], ...npx('@modelcontextprotocol/server-brave-search'), fields: [secret('BRAVE_API_KEY', 'API key')] },
  { slug: 'maps', name: 'Google Maps', description: 'Places, directions and distances.', categories: ['productivity'], ...npx('@modelcontextprotocol/server-google-maps'), fields: [secret('GOOGLE_MAPS_API_KEY', 'API key')] },
  { slug: 'figma', name: 'Figma', description: 'Read designs from Figma files.', categories: ['images & design'], ...npx('figma-developer-mcp', '--stdio'), fields: [secret('FIGMA_API_KEY', 'Personal access token')] },
  // --- no key needed ---
  { slug: 'memory', name: 'Knowledge graph memory', description: 'Long-term memory as a small knowledge graph.', categories: ['productivity'], ...npx('@modelcontextprotocol/server-memory'), fields: [] },
  { slug: 'thinking', name: 'Step-by-step thinking', description: 'Helps the Bot break hard problems into steps.', categories: ['productivity'], ...npx('@modelcontextprotocol/server-sequential-thinking'), fields: [] },
  { slug: 'puppeteer', name: 'Puppeteer browser', description: 'Second browser tool: screenshots and page scripts.', categories: ['developer tools'], ...npx('@modelcontextprotocol/server-puppeteer'), fields: [] },
  { slug: 'kubernetes', name: 'Kubernetes', description: 'Manage clusters from your kubeconfig.', categories: ['developer tools'], ...npx('mcp-server-kubernetes'), fields: [] },
  // --- search and scraping ---
  { slug: 'firecrawl', name: 'Firecrawl', description: 'Scrape and crawl websites into clean text.', categories: ['productivity'], ...npx('firecrawl-mcp'), fields: [secret('FIRECRAWL_API_KEY', 'API key')] },
  { slug: 'tavily', name: 'Tavily', description: 'Web search built for agents.', categories: ['productivity'], ...npx('tavily-mcp'), fields: [secret('TAVILY_API_KEY', 'API key')] },
  { slug: 'exa', name: 'Exa', description: 'Semantic web search.', categories: ['productivity'], ...npx('exa-mcp-server'), fields: [secret('EXA_API_KEY', 'API key')] },
  { slug: 'apify', name: 'Apify', description: 'Run thousands of ready-made web scrapers.', categories: ['productivity'], ...npx('@apify/actors-mcp-server'), fields: [secret('APIFY_TOKEN', 'API token')] },
  { slug: 'youtube', name: 'YouTube', description: 'Search videos, read transcripts and channel stats.', categories: ['social'], ...npx('@kirbah/mcp-youtube'), fields: [secret('YOUTUBE_API_KEY', 'YouTube Data API key')] },
  // --- developer tools and data ---
  { slug: 'gitlab', name: 'GitLab', description: 'Projects, issues and merge requests.', categories: ['developer tools'], ...npx('@zereight/mcp-gitlab'), fields: [secret('GITLAB_PERSONAL_ACCESS_TOKEN', 'Personal access token')] },
  { slug: 'postgres', name: 'PostgreSQL', description: 'Read-only SQL on a Postgres database.', categories: ['developer tools'], ...npx('@modelcontextprotocol/server-postgres', '{url}'), fields: [{ key: 'url', label: 'Connection string', secret: true, kind: 'arg' }] },
  { slug: 'mongodb', name: 'MongoDB', description: 'Query and manage MongoDB.', categories: ['developer tools'], ...npx('mongodb-mcp-server'), fields: [secret('MDB_MCP_CONNECTION_STRING', 'Connection string')] },
  { slug: 'redis', name: 'Redis', description: 'Read and write Redis keys.', categories: ['developer tools'], ...npx('@modelcontextprotocol/server-redis', '{url}'), fields: [{ key: 'url', label: 'Redis URL', secret: true, kind: 'arg' }] },
  { slug: 'supabase', name: 'Supabase', description: 'Projects, tables and SQL on Supabase.', categories: ['developer tools'], ...npx('@supabase/mcp-server-supabase'), fields: [secret('SUPABASE_ACCESS_TOKEN', 'Access token')] },
  { slug: 'neon', name: 'Neon', description: 'Serverless Postgres branches and queries.', categories: ['developer tools'], ...npx('@neondatabase/mcp-server-neon', 'start', '{key}'), fields: [{ key: 'key', label: 'API key', secret: true, kind: 'arg' }] },
  { slug: 'pinecone', name: 'Pinecone', description: 'Vector indexes and search.', categories: ['developer tools'], ...npx('@pinecone-database/mcp'), fields: [secret('PINECONE_API_KEY', 'API key')] },
  { slug: 'sentry', name: 'Sentry', description: 'Errors and performance issues.', categories: ['developer tools'], ...npx('@sentry/mcp-server'), fields: [secret('SENTRY_ACCESS_TOKEN', 'Access token')] },
  { slug: 'resend', name: 'Resend', description: 'Send email with Resend.', categories: ['communication'], ...npx('resend-mcp'), fields: [secret('RESEND_API_KEY', 'API key')] },
  { slug: 'mapbox', name: 'Mapbox', description: 'Geocoding, routes and maps.', categories: ['productivity'], ...npx('@mapbox/mcp-server'), fields: [secret('MAPBOX_ACCESS_TOKEN', 'Access token')] },
  // --- business and productivity ---
  { slug: 'airtable', name: 'Airtable', description: 'Bases, tables and records.', categories: ['productivity'], ...npx('airtable-mcp-server'), fields: [secret('AIRTABLE_API_KEY', 'Personal access token')] },
  { slug: 'todoist', name: 'Todoist', description: 'Tasks and projects.', categories: ['productivity'], ...npx('@doist/todoist-ai'), fields: [secret('TODOIST_API_KEY', 'API token')] },
  { slug: 'hubspot', name: 'HubSpot', description: 'Contacts, companies and deals.', categories: ['sales & crm'], ...npx('@hubspot/mcp-server'), fields: [secret('PRIVATE_APP_ACCESS_TOKEN', 'Private app token')] },
  { slug: 'stripe', name: 'Stripe', description: 'Customers, payments and invoices.', categories: ['payments'], ...npx('@stripe/mcp', '--tools=all', '--api-key={key}'), fields: [{ key: 'key', label: 'Secret or restricted key', secret: true, kind: 'arg' }] },
  { slug: 'discord', name: 'Discord', description: 'Read and send messages in your servers.', categories: ['communication'], ...npx('mcp-discord'), fields: [secret('DISCORD_TOKEN', 'Bot token')] },
  // --- hosted servers, you sign in once in a browser window on this computer (via mcp-remote) ---
  { slug: 'linear', name: 'Linear', description: 'Issues and projects. You sign in once in your browser.', categories: ['developer tools', 'productivity'], command: '', args: [], url: 'https://mcp.linear.app/mcp', fields: [] },
  { slug: 'atlassian', name: 'Jira & Confluence', description: 'Tickets and docs. You sign in once in your browser.', categories: ['developer tools', 'productivity'], command: '', args: [], url: 'https://mcp.atlassian.com/v1/sse', fields: [] },
  { slug: 'asana', name: 'Asana', description: 'Tasks and projects. You sign in once in your browser.', categories: ['productivity'], command: '', args: [], url: 'https://mcp.asana.com/sse', fields: [] },
  { slug: 'paypal', name: 'PayPal', description: 'Invoices and orders. You sign in once in your browser.', categories: ['payments'], command: '', args: [], url: 'https://mcp.paypal.com/sse', fields: [] },
  { slug: 'webflow', name: 'Webflow', description: 'Sites and CMS. You sign in once in your browser.', categories: ['developer tools'], command: '', args: [], url: 'https://mcp.webflow.com/sse', fields: [] },
  { slug: 'cloudflare', name: 'Cloudflare', description: 'Workers, DNS and storage. You sign in once in your browser.', categories: ['developer tools'], command: '', args: [], url: 'https://bindings.mcp.cloudflare.com/sse', fields: [] },
];

export interface CustomApp {
  slug: string; name: string; kind: 'mcp' | 'http'; description?: string;
  url?: string; method?: string; headers?: string; body?: string; command?: string; args?: string[]; env?: Record<string, string>;
}

interface Row { slug: string; name: string; kind: string; config: any }
const rows = (): Row[] => (db.prepare('SELECT * FROM apps ORDER BY created_at').all() as any[]).map((r) => ({ ...r, config: JSON.parse(r.config) }));

// ---------- listing ----------

/** Brand logos shipped in web/public/logos (Simple Icons, CC0). Others show a letter tile. */
const LOGOS = new Set(["airtable", "asana", "atlassian", "brave", "browser", "cloudflare", "discord", "docs", "figma", "github", "gitlab", "hubspot", "kubernetes", "linear", "mapbox", "maps", "mongodb", "notion", "paypal", "postgres", "puppeteer", "redis", "resend", "sentry", "slack", "stripe", "supabase", "todoist", "webflow", "youtube"]);
const logoOf = (slug: string) => (LOGOS.has(slug) ? `/logos/${slug}.svg` : undefined);

export function listApps(): Toolkit[] {
  const mine = new Map(rows().map((r) => [r.slug, r]));
  const catalog = CATALOG.map((c): Toolkit => ({
    slug: c.slug, name: c.name, logo: logoOf(c.slug), description: c.description, categories: c.categories,
    managedAuth: false, noAuth: false, connected: mine.has(c.slug),
    needs: c.fields.map(({ key, label, secret }) => ({ key, label, secret })),
  }));
  const custom = rows().filter((r) => r.kind !== 'catalog').map((r): Toolkit => ({
    slug: r.slug, name: r.name, categories: ['custom'], managedAuth: false, noAuth: false, connected: true, custom: true, needs: [],
    description: r.config.description || (r.kind === 'http' ? `${r.config.method} ${r.config.url}` : 'Custom MCP server'),
  }));
  return [...catalog, ...custom];
}

export const connectedSlugs = () => new Set(rows().map((r) => r.slug));
export const appInfo = (slug: string) => listApps().find((a) => a.slug === slug);

// ---------- MCP clients ----------

/** OpenMausBot's OAuth for hosted MCP servers: discovery, dynamic registration, PKCE in the browser, token refresh. */
export const oauth = new McpOAuthManager({ file: path.join(os.homedir(), '.openkrishbot', 'mcp-oauth.json') });
export class SignInNeeded extends Error { constructor(public slug: string, public url: string) { super('Sign-in needed'); } }

interface Spec { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> }
interface Live { client: Client; tools: any[] }
const live = new Map<string, Live>();
const failedAt = new Map<string, number>();

function specOf(r: Row): Spec | null {
  if (r.kind === 'mcp') return r.config.url ? { url: r.config.url, headers: r.config.headers } : { command: r.config.command, args: r.config.args ?? [], env: r.config.env ?? {} };
  const cat = CATALOG.find((c) => c.slug === r.slug);
  if (!cat) return null;
  if (cat.url) return { url: cat.url };
  const values: Record<string, string> = r.config.values ?? {};
  const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
  const env: Record<string, string> = {};
  for (const f of cat.fields) if (f.kind === 'env' && values[f.key]) env[f.key] = values[f.key];
  return { command: cat.command, args: cat.args.map(sub), env };
}

async function connect(slug: string, spec: Spec): Promise<Live> {
  const have = live.get(slug);
  if (have) return have;
  const client = new Client({ name: 'openkrishbot', version: '1.0.0' });
  const token = spec.url ? await oauth.accessToken(slug, spec.url) : null;
  const transport = spec.url
    ? new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: { ...(spec.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } } })
    : new StdioClientTransport({ command: launchCommand(spec.command!), args: spec.args ?? [], env: launchEnv(spec.env), stderr: 'ignore' });
  try { await client.connect(transport); } catch (e: any) {
    if (spec.url && (e?.code === 401 || /\b401\b|unauthori[sz]ed/i.test(String(e?.message)))) throw new SignInNeeded(slug, spec.url);
    throw e;
  }
  const entry = { client, tools: (await client.listTools()).tools };
  // a child that dies later must not stay cached: drop it so the next call starts a fresh one
  client.onclose = () => { if (live.get(slug) === entry) { live.delete(slug); cache = null; } };
  live.set(slug, entry);
  return entry;
}

async function close(slug: string) {
  const c = live.get(slug);
  live.delete(slug);
  try { await c?.client.close(); } catch { /* already gone */ }
}

/** Save a catalog app with the user's values and check that it starts. */
export async function connectCatalogApp(slug: string, values: Record<string, string>) {
  const cat = CATALOG.find((c) => c.slug === slug);
  if (!cat) throw new Error('Unknown app');
  if (false) void McpHttpError;
  const missing = cat.fields.filter((f) => !String(values[f.key] ?? '').trim());
  if (missing.length) throw new Error(`Fill in: ${missing.map((f) => f.label).join(', ')}`);
  await close(slug);
  const config: any = { values };
  const row: Row = { slug, name: cat.name, kind: 'catalog', config };
  try { await connect(slug, specOf(row)!); } catch (e: any) { await close(slug); if (e instanceof SignInNeeded) throw e; throw new Error(`Couldn’t start ${cat.name}: ${e.message}${cat.url ? '' : '. Is Node.js installed?'}`); }
  failedAt.delete(slug);
  db.prepare('INSERT OR REPLACE INTO apps(slug,name,kind,config,created_at) VALUES (?,?,?,?,?)').run(slug, cat.name, 'catalog', JSON.stringify(config), now());
}

export async function addCustomApp(a: Partial<CustomApp>) {
  const name = String(a.name ?? '').trim();
  if (!name || !(a.url || a.command)) throw new Error('Name and a URL or command are required');
  const slug = `c_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'app'}`;
  const kind = a.kind === 'http' ? 'http' : 'mcp';
  const config: Partial<CustomApp> = kind === 'http'
    ? { description: a.description, url: a.url, method: a.method || 'GET', headers: a.headers ?? '', body: a.body ?? '' }
    : { description: a.description, url: a.url, headers: a.headers as any, command: a.command, args: a.args ?? [], env: a.env };
  const row: Row = { slug, name, kind, config };
  if (kind === 'mcp') {
    await close(slug);
    try { await connect(slug, specOf(row)!); } catch (e: any) { await close(slug); if (e instanceof SignInNeeded) throw e; throw new Error(`Couldn’t start it: ${e.message}`); }
  }
  failedAt.delete(slug);
  db.prepare('INSERT OR REPLACE INTO apps(slug,name,kind,config,created_at) VALUES (?,?,?,?,?)').run(slug, name, kind, JSON.stringify(config), now());
}

export async function removeApp(slug: string) {
  db.prepare('DELETE FROM apps WHERE slug=?').run(slug);
  await close(slug);
}

// ---------- tools ----------

export interface AppTool {
  /** `<slug>__<tool>`: what the agent calls (after the app's own prefix). */
  name: string;
  slug: string;
  appName: string;
  description: string;
  inputSchema: any;
  readOnly: boolean;
  run: (args: any, signal?: AbortSignal) => Promise<string>;
}

const clip = (s: string, n = 60_000) => (s.length > n ? `${s.slice(0, n)}…(truncated)` : s);
const toolName = (slug: string, tool: string) => `${slug.replace(/\W/g, '_')}__${tool}`.slice(0, 64);

/** A write that failed on the wire may still have happened (openfuse idea): say so, so the bot checks instead of sending twice. */
export function unknownOutcome(method: string, e: any): string {
  const msg = e?.message ?? String(e);
  return method === 'GET' ? msg : `${msg}. The request may still have gone through: check the result before trying again, do not send it twice.`;
}

function httpTool(r: Row): AppTool {
  const c = r.config;
  const fillText = [c.url, c.body, c.headers].join('\n');
  const params = [...new Set([...fillText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const fill = (s: string, a: any, enc = false) => String(s ?? '').replace(/\{(\w+)\}/g, (_, k) => (a[k] == null ? '' : enc ? encodeURIComponent(a[k]) : String(a[k])));
  const method: string = c.method || 'GET';
  return {
    name: toolName(r.slug, 'call'), slug: r.slug, appName: r.name, readOnly: method === 'GET',
    description: c.description || `Call the ${r.name} API (${method}).`,
    inputSchema: { type: 'object', properties: Object.fromEntries(params.map((p) => [p, { type: 'string' }])), required: params },
    run: async (a, signal) => {
      const headers: Record<string, string> = {};
      for (const line of String(c.headers || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = fill(line.slice(i + 1).trim(), a); }
      const body = method === 'GET' || !c.body ? undefined : fill(c.body, a);
      if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      try {
        const res = await fetch(fill(c.url, a, true), { method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)].filter((s): s is AbortSignal => !!s)) });
        return clip(`HTTP ${res.status}\n${await res.text()}`);
      } catch (e: any) { throw new Error(unknownOutcome(method, e)); }
    },
  };
}

let cache: { at: number; tools: AppTool[] } | null = null;
export const forgetAppTools = () => { cache = null; };

/** Every tool of every connected app. Apps that fail to start are skipped (and logged once per refresh). */
const CONNECT_MS = 15_000;

/** All apps connect at once, each with its own deadline; one that failed is not retried for a minute, so a broken app can't slow every turn. */
async function toolsOf(r: Row): Promise<AppTool[]> {
  if (r.kind === 'http') return [httpTool(r)];
  const spec = specOf(r);
  if (!spec || Date.now() - (failedAt.get(r.slug) ?? 0) < 60_000) return [];
  try {
    const { client, tools } = await Promise.race([
      connect(r.slug, spec),
      new Promise<never>((_, no) => setTimeout(() => no(new Error(`no answer in ${CONNECT_MS / 1000}s`)), CONNECT_MS).unref()),
    ]);
    failedAt.delete(r.slug);
    return tools.map((t): AppTool => ({
      name: toolName(r.slug, t.name), slug: r.slug, appName: r.name, description: t.description || t.name, inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      readOnly: !!t.annotations?.readOnlyHint,
      run: async (args) => {
        const res: any = await client.callTool({ name: t.name, arguments: args });
        if (res.isError) throw new Error(clip((res.content ?? []).map((c: any) => c.text ?? `[${c.type}]`).join('\n') || 'The app reported an error.'));
        return clip((res.content ?? []).map((c: any) => c.text ?? `[${c.type}]`).join('\n') || '(empty)');
      },
    }));
  } catch (e: any) {
    console.warn(`[apps] ${r.name} is not reachable: ${e?.message ?? e}`);
    failedAt.set(r.slug, Date.now());
    await close(r.slug);
    return [];
  }
}

export async function appTools(): Promise<AppTool[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.tools;
  const out = (await Promise.all(rows().map(toolsOf))).flat();
  cache = { at: Date.now(), tools: out };
  return out;
}

export const findAppTool = async (name: string) => (await appTools()).find((t) => t.name.toLowerCase() === name.toLowerCase());

/** The app a call to `name` belongs to, for approval cards (no start-up of servers). */
export const humanizeTool = (name: string) => {
  const [slug, ...rest] = name.split('__');
  const app = appInfo(slug)?.name ?? slug;
  return `${app}: ${rest.join('__').replace(/[_-]+/g, ' ').toLowerCase()}`;
};

/** A tool from the last listing, without starting anything. */
export const cachedAppTool = (name: string) => cache?.tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
