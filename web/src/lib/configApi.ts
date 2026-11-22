import type { Bot, ComputerState, EngineInfo, LibraryFile, Memory, Routine, Skill, Task, Toolkit } from '@shared/types';
import { ApiError } from './api';

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
  return res.json() as Promise<T>;
}

export interface BotSettingsBundle {
  memories: Memory[];
  skills: Skill[];
  routines: Routine[];
  tasks: Task[];
  memory: { lastConsolidatedAt: number | null; historyChars: number; compactAtChars: number; lastCompaction: { method: string; created_at: number } | null };
}

export interface LibraryListing { status: 'ok' | 'asleep' | 'error'; path: string; files: LibraryFile[]; error?: string }

export interface ComputerDetails {
  computer: ComputerState;
  screens: { botId: string; screenId: string; lastUsedAt: number }[];
  hibernation: { idleMinutes: number; viewers: number; dryRun: boolean };
}

export type BotPatch = Partial<Pick<Bot, 'name' | 'label' | 'description' | 'instructions' | 'avatarShape' | 'avatarColor' | 'effort' | 'mode'>>;

export interface PhoneInfo {
  lan: { label: string; url: string }[];
  tunnel: { on: boolean; url: string | null; error: string | null };
  devices: { id: string; name: string; pairedAt: number; lastSeen: number | null }[];
}

export interface WhatsAppInfo { status: 'off' | 'starting' | 'qr' | 'connected' | 'error'; qr: string | null; me: string | null; error: string | null; allow: string[] }

export interface AuditEntry { t: string; bot: string; tool: string; status: string; danger?: string | null; args?: string }

export interface FlowStep { id: string; bot: string; prompt: string; needs?: string[]; retries?: number; gate?: boolean }
export interface Flow { id: string; name: string; steps: FlowStep[]; schedule?: string }
export interface StepResult { status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; output?: string; error?: string; attempts: number }
export interface FlowRun { id: string; flowId: string; input: string; status: 'running' | 'done' | 'failed' | 'stopped'; results: Record<string, StepResult> }

export type IssueStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type GoalLevel = 'mission' | 'project' | 'task';
export type GoalStatus = 'planned' | 'active' | 'achieved' | 'cancelled';
export interface Goal { id: string; title: string; description: string; level: GoalLevel; status: GoalStatus; parentId: string | null; ownerBotId: string | null; done: number; total: number }
export interface Issue { id: string; title: string; body: string; status: IssueStatus; assigneeBotId: string | null; parentId: string | null; checkoutBotId: string | null; result: string; goalId: string | null; updatedAt: number }

export interface Price { inPerM: number; outPerM: number }
export interface BudgetInfo { dailyTokens: number | null; today: { tokensIn: number; tokensOut: number; calls: number; costUsd: number }; price: Price | null }

export interface LibrarySkill { id: string; name: string; description: string; triggers: string[]; enabled: boolean; custom?: boolean }

export interface TelegramInfo { status: 'off' | 'running' | 'error'; bot: string | null; error: string | null; hasToken: boolean; paired: number; pairCode: string | null }

export interface VaultItem { id: string; name: string; origin: string; auth: 'bearer' | 'header' | 'basic' | 'login'; header: string; username: string; updatedAt: number }
export interface ProjectInfo { id: string; name: string; instructions: string; files: { id: string; name: string; size: number }[]; botIds: string[]; updatedAt: number }

export const configApi = {
  telegram: () => req<TelegramInfo>('GET', '/telegram'),
  telegramToken: (token: string) => req<{ status: string; error: string | null }>('PUT', '/telegram/token', { token }),
  telegramPairCode: () => req<{ pairCode: string }>('POST', '/telegram/pair-code', {}),
  telegramStart: () => req<{ status: string; error: string | null }>('POST', '/telegram/start', {}),
  telegramStop: () => req<{ ok: true }>('POST', '/telegram/stop', {}),
  telegramUnlink: () => req<{ ok: true }>('POST', '/telegram/unlink', {}),
  skillLibrary: () => req<{ skills: LibrarySkill[] }>('GET', '/skill-library'),
  importSkill: (b: { url?: string; markdown?: string }) => req<{ id: string; name: string }>('POST', '/skill-library/import', b),
  removeLibrarySkill: (id: string) => req<{ ok: true }>('DELETE', `/skill-library/${id}`),
  setLibrarySkill: (id: string, enabled: boolean) => req<{ id: string; enabled: boolean }>('PUT', `/skill-library/${id}`, { enabled }),
  budget: (botId: string) => req<BudgetInfo>('GET', `/bots/${botId}/budget`),
  setPrice: (botId: string, p: Price | null) => req<BudgetInfo>('PUT', `/bots/${botId}/price`, p),
  queue: (botId: string) => req<{ paused: boolean; running: boolean; pending: { id: number; label: string }[] }>('GET', `/bots/${botId}/queue`),
  queueAction: (botId: string, action: 'pause' | 'resume' | 'cancel', id?: number) => req<{ paused: boolean; running: boolean; pending: { id: number; label: string }[] }>('POST', `/bots/${botId}/queue/${action}`, { id }),
  scripts: (botId: string) => req<{ enabled: boolean }>('GET', `/bots/${botId}/scripts`),
  enableScripts: (botId: string) => req<{ enabled: boolean; token: string }>('POST', `/bots/${botId}/scripts`),
  disableScripts: (botId: string) => req<{ enabled: boolean }>('DELETE', `/bots/${botId}/scripts`),
  setBudget: (botId: string, dailyTokens: number | null) => req<BudgetInfo>('PUT', `/bots/${botId}/budget`, { dailyTokens }),
  issues: () => req<{ issues: Issue[] }>('GET', '/issues'),
  projects: () => req<{ projects: ProjectInfo[] }>('GET', '/projects'),
  addProject: (p: { name: string; instructions?: string }) => req<{ project: ProjectInfo }>('POST', '/projects', p),
  patchProject: (id: string, p: { name?: string; instructions?: string }) => req<{ project: ProjectInfo }>('PATCH', `/projects/${id}`, p),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/projects/${id}`),
  addProjectFile: (id: string, f: { name: string; content: string }) => req<{ project: ProjectInfo }>('POST', `/projects/${id}/files`, f),
  deleteProjectFile: (id: string, fileId: string) => req<{ ok: true }>('DELETE', `/projects/${id}/files/${fileId}`),
  vault: () => req<{ items: VaultItem[] }>('GET', '/vault'),
  saveSecret: (b: { name: string; value?: string; origin?: string; auth?: string; header?: string; username?: string }) => req<{ item: VaultItem }>('PUT', '/vault', b),
  deleteSecret: (name: string) => req<{ ok: true }>('DELETE', `/vault/${encodeURIComponent(name)}`),
  importCompany: (data: unknown) => req<{ project: ProjectInfo }>('POST', '/projects/import', data),
  companyTemplates: () => req<{ templates: { id: string; name: string; goal: string; bots: string[] }[] }>('GET', '/projects/templates'),
  addCompanyTemplate: (id: string) => req<{ project: ProjectInfo }>('POST', `/projects/templates/${id}`),
  assignProject: (botId: string, projectId: string | null) => req<{ ok: true }>('PUT', '/projects/assign', { botId, projectId }),
  goals: () => req<{ goals: Goal[] }>('GET', '/goals'),
  addGoal: (g: { title: string; description?: string; level?: GoalLevel; parentId?: string | null; ownerBotId?: string | null }) => req<{ goal: Goal }>('POST', '/goals', g),
  patchGoal: (id: string, p: Partial<Pick<Goal, 'title' | 'description' | 'level' | 'status' | 'parentId' | 'ownerBotId'>>) => req<{ goal: Goal }>('PATCH', `/goals/${id}`, p),
  deleteGoal: (id: string) => req<{ ok: true }>('DELETE', `/goals/${id}`),
  linkIssue: (issueId: string, goalId: string | null) => req<{ ok: true }>('PUT', '/goals/link', { issueId, goalId }),
  addIssue: (i: { title: string; body?: string; assigneeBotId?: string | null; goalId?: string | null }) => req<{ issue: Issue }>('POST', '/issues', i),
  patchIssue: (id: string, p: { status?: IssueStatus; assigneeBotId?: string | null }) => req<{ issue: Issue }>('PATCH', `/issues/${id}`, p),
  issueComments: (id: string) => req<{ comments: { id: string; author: string; text: string; createdAt: number }[] }>('GET', `/issues/${id}/comments`),
  addIssueComment: (id: string, text: string) => req<{ comment: { id: string } }>('POST', `/issues/${id}/comments`, { text }),
  deleteIssue: (id: string) => req<{ ok: true }>('DELETE', `/issues/${id}`),
  flows: () => req<{ flows: Flow[] }>('GET', '/flows'),
  saveFlow: (f: { id?: string; name: string; steps: FlowStep[]; schedule?: string }) => req<{ flow: Flow }>('PUT', '/flows', f),
  planFlow: (goal: string) => req<{ steps: FlowStep[]; planner: string }>('POST', '/flows/plan', { goal }),
  deleteFlow: (id: string) => req<{ ok: true }>('DELETE', `/flows/${id}`),
  runFlow: (id: string, input: string) => req<{ runId: string }>('POST', `/flows/${id}/run`, { input }),
  flowRun: (runId: string) => req<{ run: FlowRun }>('GET', `/flows/runs/${runId}`),
  flowRuns: (id: string) => req<{ runs: FlowRun[] }>('GET', `/flows/${id}/runs`),
  resumeFlowRun: (runId: string) => req<{ runId: string }>('POST', `/flows/runs/${runId}/resume`, {}),
  stopFlowRun: (runId: string) => req<{ ok: true }>('POST', `/flows/runs/${runId}/stop`, {}),
  dangerMode: () => req<{ mode: 'ask' | 'follow' }>('GET', '/audit/danger-mode'),
  setDangerMode: (mode: 'ask' | 'follow') => req<{ mode: 'ask' | 'follow' }>('PUT', '/audit/danger-mode', { mode }),
  usage: () => req<{ usage: { botId: string; name: string; tokensIn: number; tokensOut: number; calls: number; costUsd: number }[] }>('GET', '/usage'),
  audit: () => req<{ entries: AuditEntry[] }>('GET', '/audit'),
  whatsapp: () => req<WhatsAppInfo>('GET', '/whatsapp'),
  whatsappStart: () => req<{ ok: true }>('POST', '/whatsapp/start', {}),
  whatsappStop: () => req<{ ok: true }>('POST', '/whatsapp/stop', {}),
  whatsappUnlink: () => req<{ ok: true }>('POST', '/whatsapp/unlink', {}),
  whatsappAllow: (numbers: string[]) => req<{ ok: true; allow: string[] }>('PUT', '/whatsapp/allow', { numbers }),
  phone: () => req<PhoneInfo>('GET', '/phone'),
  phonePair: (via: 'lan' | 'tunnel') => req<{ url: string; qr: string; expiresInSec: number }>('POST', '/phone/pair', { via }),
  phoneTunnel: (on: boolean) => req<{ ok: true; url: string | null }>('POST', '/phone/tunnel', { on }),
  phoneRemove: (id: string) => req<{ ok: true }>('DELETE', `/phone/devices/${id}`),
  settings: (botId: string) => req<BotSettingsBundle>('GET', `/bots/${botId}/settings`),
  updateBot: (botId: string, p: BotPatch) => req<{ bot: Bot }>('PATCH', `/bots/${botId}`, p),
  deleteBot: (botId: string) => req<{ ok: true }>('DELETE', `/bots/${botId}`),
  makePrimary: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/primary`),
  fresh: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/fresh`),

  deleteMemory: (id: string) => req<{ ok: true }>('DELETE', `/memories/${id}`),

  createSkill: (botId: string, s: Pick<Skill, 'name' | 'description' | 'body'>) => req<{ skill: Skill }>('POST', `/bots/${botId}/skills`, s),
  updateSkill: (id: string, s: Partial<Pick<Skill, 'name' | 'description' | 'body'>>) => req<{ skill: Skill }>('PATCH', `/skills/${id}`, s),
  deleteSkill: (id: string) => req<{ ok: true }>('DELETE', `/skills/${id}`),

  setRoutine: (id: string, enabled: boolean) => req<{ routine: Routine }>('PATCH', `/routines/${id}`, { enabled }),
  runRoutine: (id: string) => req<{ ok: true }>('POST', `/routines/${id}/run`),
  deleteRoutine: (id: string) => req<{ ok: true }>('DELETE', `/routines/${id}`),

  tasks: () => req<{ tasks: Task[] }>('GET', '/tasks'),
  botTasks: (botId: string) => req<{ tasks: Task[] }>('GET', `/bots/${botId}/tasks`),

  files: (botId: string, path = '', wake = false) => req<LibraryListing>('GET', `/bots/${botId}/files?path=${encodeURIComponent(path)}${wake ? '&wake=1' : ''}`),
  downloadFile: (botId: string, path: string) => req<{ url: string }>('POST', `/bots/${botId}/files/download`, { path }),

  computerDetails: () => req<ComputerDetails>('GET', '/computer/details'),
  wake: () => req<{ computer: ComputerState }>('POST', '/computer/ensure'),
  sleep: () => req<{ computer: ComputerState }>('POST', '/computer/suspend'),
  resetScreen: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/screen/reset`),
  /** Tells the bot the person has stopped driving its screen. */
  handback: (botId: string) => req<{ ok: true }>('POST', `/bots/${botId}/handback`),

  engine: (botId: string) => req<{ engine: EngineInfo }>('GET', `/bots/${botId}/engine`),
  setEngine: (botId: string, p: { provider?: string | null; model?: string | null }) => req<{ engine: EngineInfo }>('PATCH', `/bots/${botId}/engine`, p),
  /** Opens the provider's sign-in flow in a terminal on the bot's screen. */
  engineLogin: (botId: string, provider?: string) => req<{ ok: true }>('POST', `/bots/${botId}/engine/login`, provider ? { provider } : {}),
  restartEngine: (botId: string) => req<{ engine: EngineInfo }>('POST', `/bots/${botId}/engine/restart`),
  /** Stops the private screen the agent runs for itself, so its computer work shows on the screen in the app. */
  stopOwnScreen: (botId: string) => req<{ engine: EngineInfo }>('POST', `/bots/${botId}/engine/screen/stop`),

  policies: () => req<{ policies: { tool: string; mode: string }[] }>('GET', '/policies'),
  deletePolicy: (tool: string) => req<{ ok: true }>('DELETE', `/policies/${encodeURIComponent(tool)}`),

  connectedApps: () => req<{ connectedApps?: Toolkit[]; connected: string[] }>('GET', '/apps?limit=1'),
  logout: () => req<{ ok: true }>('POST', '/auth/logout'),
};
