import type { Bot, ComputerState, LiveState, Routine, Row, Toolkit, User } from '@shared/types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface SignIn { phase: 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'expired'; flowId: string; authorizationUrl: string | null; message?: string }
/** A hosted app wants a sign-in: open the provider's page, wait for it to finish, then run the same call again. */
async function withSignIn(slug: string, call: () => Promise<{ ok: true; signIn?: SignIn }>): Promise<{ ok: true }> {
  const first = await call();
  if (!first.signIn) return { ok: true };
  if (first.signIn.authorizationUrl) window.open(first.signIn.authorizationUrl, '_blank', 'noopener');
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { signIn } = await api.signInStatus(slug, first.signIn.flowId);
    if (signIn.phase === 'succeeded') { const again = await call(); if (again.signIn) throw new Error('Sign-in did not stick. Try again.'); return { ok: true }; }
    if (signIn.phase !== 'waiting') throw new Error(signIn.message || `Sign-in ${signIn.phase}.`);
  }
  throw new Error('Sign-in timed out. Try again.');
}

export interface AppsResponse { apps: Toolkit[]; connected: string[]; categories: string[]; total: number }

export interface RegistryField { key: string; label: string; secret: boolean }
export interface RegistryHit { id: string; name: string; description: string; command?: string; args?: string[]; env?: RegistryField[]; url?: string; headers?: RegistryField[] }

export interface RoomMember { id: string; name: string; label: string; avatarShape: string; avatarColor: string }

export const api = {
  me: () => req<{ user: User | null; devLogin: boolean }>('GET', '/auth/me'),
  devLogin: (email: string, name?: string) => req<{ ok: true }>('POST', '/auth/dev', { email, name }),
  logout: () => req<{ ok: true }>('POST', '/auth/logout'),

  bots: () => req<{ bots: Bot[]; live: LiveState[] }>('GET', '/bots'),
  createBot: (b: Pick<Bot, 'name' | 'avatarShape' | 'avatarColor' | 'mode'> & Partial<Pick<Bot, 'label' | 'description' | 'instructions'>>) => req<{ bot: Bot }>('POST', '/bots', b),
  markRead: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/read`),
  rows: (id: string) => req<{ generation: number; rows: Row[] }>('GET', `/bots/${id}/rows`),
  send: (id: string, text: string) => req<{ row: Row }>('POST', `/bots/${id}/messages`, { text }),
  interrupt: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/interrupt`),
  duplicate: (id: string) => req<{ bot: Bot }>('POST', `/bots/${id}/duplicate`),
  makeChief: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/primary`),
  fresh: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/fresh`),

  approve: (approvalId: string, decision: 'allow' | 'always' | 'deny', edit?: Record<string, unknown>) => req<{ ok: true }>('POST', `/approvals/${approvalId}`, { decision, edit }),
  answer: (id: string, seq: number, answer: string) => req<{ ok: true }>('POST', `/bots/${id}/cards/${seq}/answer`, { answer }),
  dismiss: (id: string, seq: number) => req<{ ok: true }>('POST', `/bots/${id}/cards/${seq}/dismiss`),

  routines: (id: string) => req<{ routines: Routine[] }>('GET', `/bots/${id}/routines`),
  setRoutine: (rid: string, enabled: boolean) => req<{ routine: Routine }>('PATCH', `/routines/${rid}`, { enabled }),

  computer: () => req<{ computer: ComputerState }>('GET', '/computer'),
  ensureComputer: () => req<{ computer: ComputerState }>('POST', '/computer/ensure'),

  apps: (search = '', category = '') => req<AppsResponse>('GET', `/apps?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}`),
  connect: (slug: string, values: Record<string, string> = {}, botId?: string, seq?: number) => withSignIn(slug, () => req<{ ok: true; signIn?: SignIn }>('POST', `/apps/${slug}/connect`, { values, botId, seq })),
  signInStatus: (slug: string, flowId: string) => req<{ signIn: SignIn }>('GET', `/apps/${slug}/signin/${flowId}`),
  searchRegistry: (q: string) => req<{ results: RegistryHit[] }>('GET', `/apps/registry?q=${encodeURIComponent(q)}`),
  addCustomApp: (app: Record<string, unknown>) => withSignIn(String(app.slug ?? `c_${String(app.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`), () => req<{ ok: true; signIn?: SignIn }>('POST', '/apps/custom', app)),
  disconnect: (slug: string) => req<{ ok: true }>('DELETE', `/apps/${slug}`),

  roomMembers: (id: string) => req<{ members: RoomMember[] }>('GET', `/rooms/${id}/members`),
  setRoomMembers: (id: string, botIds: string[]) => req<{ ok: true; members: string[] }>('PUT', `/rooms/${id}/members`, { botIds }),
  createRoom: (name: string, botIds: string[]) => req<{ id: string }>('POST', '/rooms', { name, botIds }),
};
