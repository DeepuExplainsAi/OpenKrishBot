import { goalsFor } from '../goals.js';
import { addComment, checkout, createIssue, finish, issuesFor, listComments } from '../issues.js';
import { db, now } from '../db.js';
import { activePlan, createPlan, markStep, render, saveSteps } from '../plan.js';
import { newId } from '../lib/ids.js';
import { hub } from '../lib/hub.js';
import { box } from '../box.js';
import { env } from '../env.js';
import { libraryRoot } from '../paths.js';
import { installSkill } from '../skill-library.js';
import { siteFile } from '../sites.js';
import { appendRow, getBotRow, listRoutines, toRoutine, describeCron } from '../store.js';
import { appInfo, cachedAppTool, findAppTool, humanizeTool } from '../apps.js';
import { scheduleRoutine, unscheduleRoutine } from '../routines.js';
import { readProjectFileByName } from '../projects.js';
import { createFeedRoutine, createWebhookRoutine, describeEvent } from '../triggers.js';
import { setCheckins } from '../proactive.js';
import { createRoom, postToRoom } from './rooms.js';
import type { ActivityKind } from '../types.js';
import { Cron } from 'croner';

export interface ToolCtx {
  userId: string;
  botId: string;
  enqueueBotMessage: (fromBotId: string, toBotId: string, text: string, depth: number) => void;
  depth: number;
}

export interface ToolResult {
  /** Text handed back to the agent. */
  output: string;
  summary?: string;
  /** End the turn after this tool (e.g. a question was asked). */
  endTurn?: boolean;
}

type Impl = (args: any, ctx: ToolCtx) => Promise<ToolResult>;

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  activity: ActivityKind;
  label: string;
  impl: Impl;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

function botByName(userId: string, name: string) {
  return db.prepare('SELECT * FROM bots WHERE user_id=? AND lower(name)=lower(?)').get(userId, name.trim()) as any;
}

const CONDITIONS = {
  type: 'array',
  description: 'Optional "only if" filters. The routine runs only when ALL hold. field is a dot path into the event (webhook JSON body, or feed item: title, link, summary, author), op is one of exists, equals, not_equals, contains, not_contains, starts_with, greater_than, less_than.',
  items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: { type: 'string' } }, required: ['field', 'op'] },
};

export const TOOLS: ToolDef[] = [
  {
    name: 'save_file',
    description: "Save a finished deliverable (report, notes, CSV, code, markdown) to your Library so the user can open and download it. It lands in your Library folder on your computer (the path is in your instructions); files you write into that folder yourself show up in the Library too.",
    parameters: obj({ filename: { type: 'string', description: 'e.g. briefing-2026-11-09.md' }, content: { type: 'string' } }, ['filename', 'content']),
    activity: 'drafting_file',
    label: 'Saving a file',
    impl: async (a, ctx) => {
      const name = String(a.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file.txt';
      const file = `${libraryRoot()}/${ctx.botId}/${name}`;
      await box.writeFile(file, String(a.content ?? ''));
      return { output: JSON.stringify({ ok: true, path: file }), summary: `Saved ${name}` };
    },
  },
  {
    name: 'save_skill',
    description: 'Turn what you just did into a reusable skill so you (and other bots) do it the same way next time. Write the steps as instructions to a future you: what to ask for, what to run, what to check, what to avoid. Only save a skill for work the user would want repeated. `triggers` are phrases in a user message that should bring the skill in.',
    parameters: obj({ name: { type: 'string', description: 'Short title, e.g. "Weekly sales report"' }, description: { type: 'string' }, instructions: { type: 'string', description: 'Markdown steps' }, triggers: { type: 'array', items: { type: 'string' } } }, ['name', 'instructions']),
    activity: 'working',
    label: 'Saving a skill',
    impl: async (a) => {
      const triggers = Array.isArray(a.triggers) ? a.triggers.map((t: unknown) => String(t).replace(/[,\n]/g, ' ').trim()).filter(Boolean) : [];
      const md = `---\nname: ${String(a.name).replace(/\n/g, ' ')}\ndescription: ${String(a.description ?? '').replace(/\n/g, ' ')}\n${triggers.length ? `triggers: ${triggers.join(', ')}\n` : ''}---\n${String(a.instructions)}`;
      try { const sk = installSkill(md); return { output: JSON.stringify({ ok: true, id: sk.id, triggers: sk.triggerTerms }), summary: `Saved skill ${sk.name}` }; }
      catch (e: any) { return { output: JSON.stringify({ error: e.message }), summary: 'Skill not saved' }; }
    },
  },
  {
    name: 'publish_site',
    description: 'Show a website you built. Put its files (index.html, css, js, images) in a folder under your Library, e.g. site/, then call this with the folder name. It is served on this computer and only the user can open it; the result is the address.',
    parameters: obj({ folder: { type: 'string', description: 'Folder under your Library that holds index.html (default "site")' } }),
    activity: 'working',
    label: 'Publishing a site',
    impl: async (a, ctx) => {
      const folder = String(a.folder || 'site').replace(/^\/+|\/+$/g, '');
      if (!siteFile(ctx.botId, `${folder}/index.html`)) return { output: JSON.stringify({ error: `No ${folder}/index.html in your Library yet. Write it with save_file or the terminal first.` }), summary: 'Nothing to publish' };
      return { output: JSON.stringify({ ok: true, url: `/sites/${ctx.botId}/${folder}/` }), summary: `Published ${folder}/` };
    },
  },
  {
    name: 'create_routine',
    description: 'Create a recurring routine you will run on a schedule. `schedule` is a 5-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 8 * * 1-5" for weekdays at 8:00. `prompt` is the instruction you will follow each time it runs.',
    parameters: obj({ name: { type: 'string' }, prompt: { type: 'string' }, schedule: { type: 'string' }, timezone: { type: 'string', description: 'IANA timezone, e.g. America/New_York' } }, ['name', 'prompt', 'schedule']),
    activity: 'working',
    label: 'Setting up a routine',
    impl: async (a, ctx) => {
      try { new Cron(a.schedule, { paused: true, timezone: a.timezone || 'UTC' }); } catch (e: any) { return { output: `Invalid schedule: ${e.message}` }; }
      const id = newId('rt');
      db.prepare('INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at) VALUES (?,?,?,?,?,?,1,?)').run(id, ctx.botId, a.name, a.prompt, a.schedule, a.timezone || 'UTC', now());
      const r = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(id));
      scheduleRoutine(r);
      appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-created', text: `Routine created: ${a.name} · ${describeCron(a.schedule)}`, ref: id });
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: JSON.stringify({ ok: true, routine: r }), summary: `Created routine ${a.name}` };
    },
  },
  {
    name: 'create_event_routine',
    description: 'Create a routine that runs whenever something calls its webhook address (instead of on a schedule). Any service, script or automation that can send an HTTP POST can trigger it. The address is returned; give it to the user. `prompt` is what you will do each time; the request body is appended to it.',
    parameters: obj({ name: { type: 'string' }, prompt: { type: 'string' }, conditions: CONDITIONS }, ['name', 'prompt']),
    activity: 'working',
    label: 'Setting up a routine',
    impl: async (a, ctx) => {
      const r = createWebhookRoutine(ctx.botId, { name: a.name, prompt: a.prompt, conditions: a.conditions });
      appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-created', text: `Routine created: ${a.name} · ${describeEvent(r.schedule)}`, ref: r.id });
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: JSON.stringify({ ok: true, routine_id: r.id, webhook: r.url }), summary: `Created event routine ${a.name}` };
    },
  },
  {
    name: 'read_project_file',
    description: "Open one of your project's reference files by name (use it when the project section says a file is too long to include).",
    parameters: obj({ name: { type: 'string' } }, ['name']),
    activity: 'working',
    label: 'Reading a project file',
    impl: async (a, ctx) => {
      const f = readProjectFileByName(ctx.botId, String(a.name ?? ''));
      return f ? { output: f.content, summary: `Read ${f.name}` } : { output: JSON.stringify({ error: 'No such file in this bot\'s project.' }), summary: 'No such file' };
    },
  },
  {
    name: 'create_feed_routine',
    description: 'Create a routine that runs for every NEW item in an RSS or Atom feed (checked every 15 minutes while the app is open). Items already in the feed when you create it do not trigger it. `prompt` is what you should do for each item; the item (title, link, summary, author, published) is added to it.',
    parameters: obj({ name: { type: 'string' }, prompt: { type: 'string' }, url: { type: 'string', description: 'Feed address (http/https)' }, conditions: CONDITIONS }, ['name', 'prompt', 'url']),
    activity: 'working',
    label: 'Setting up a routine',
    impl: async (a, ctx) => {
      const r = createFeedRoutine(ctx.botId, { name: a.name, prompt: a.prompt, url: a.url, conditions: a.conditions });
      appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-created', text: `Routine created: ${a.name} · new items in ${a.url}`, ref: r.id });
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: JSON.stringify({ ok: true, routine_id: r.id }), summary: `Created feed routine ${a.name}` };
    },
  },
  {
    name: 'stay_silent',
    description: 'End this turn without sending the user anything. Use during check-ins, routines or bot-to-bot exchanges when there is nothing worth telling the user.',
    parameters: obj({ reason: { type: 'string' } }),
    activity: 'working',
    label: 'Finishing up',
    impl: async () => ({ output: 'OK, staying silent. End your turn now without writing a reply.', endTurn: true, summary: 'Stayed silent' }),
  },
  {
    name: 'set_checkins',
    description: "Turn proactive check-ins on or off and set when they happen (only the primary Bot does check-ins). times are local 24h 'HH:MM' strings; timezone is IANA (e.g. America/Los_Angeles). Ask the user for their timezone if you don't know it.",
    parameters: obj({ enabled: { type: 'boolean' }, times: { type: 'array', items: { type: 'string' } }, timezone: { type: 'string' } }, ['enabled']),
    activity: 'working',
    label: 'Updating check-ins',
    impl: async (a, ctx) => {
      try {
        const r = setCheckins(ctx.userId, { enabled: !!a.enabled, times: a.times, timezone: a.timezone });
        return { output: JSON.stringify({ ok: true, ...r }), summary: r.enabled ? `Check-ins at ${r.times.join(', ')} ${r.timezone}` : 'Check-ins off' };
      } catch (e: any) {
        return { output: `Could not update check-ins: ${e?.message ?? e}` };
      }
    },
  },
  {
    name: 'list_routines',
    description: 'List your routines.',
    parameters: obj({}),
    activity: 'working',
    label: 'Checking routines',
    impl: async (_a, ctx) => ({ output: JSON.stringify(listRoutines(ctx.botId)) }),
  },
  {
    name: 'update_routine',
    description: 'Change or pause one of your routines.',
    parameters: obj({ routine_id: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' }, schedule: { type: 'string' }, timezone: { type: 'string' }, enabled: { type: 'boolean' } }, ['routine_id']),
    activity: 'working',
    label: 'Updating a routine',
    impl: async (a, ctx) => {
      const cur = db.prepare('SELECT * FROM routines WHERE id=? AND bot_id=?').get(a.routine_id, ctx.botId) as any;
      if (!cur) return { output: 'No such routine.' };
      const next = { ...cur, name: a.name ?? cur.name, prompt: a.prompt ?? cur.prompt, schedule: a.schedule ?? cur.schedule, timezone: a.timezone ?? cur.timezone, enabled: a.enabled === undefined ? cur.enabled : a.enabled ? 1 : 0 };
      try { new Cron(next.schedule, { paused: true, timezone: next.timezone }); } catch (e: any) { return { output: `Invalid schedule: ${e.message}` }; }
      db.prepare('UPDATE routines SET name=?,prompt=?,schedule=?,timezone=?,enabled=? WHERE id=?').run(next.name, next.prompt, next.schedule, next.timezone, next.enabled, cur.id);
      const r = toRoutine(db.prepare('SELECT * FROM routines WHERE id=?').get(cur.id));
      r.enabled ? scheduleRoutine(r) : unscheduleRoutine(r.id);
      appendRow(ctx.botId, 'event', { type: 'event', event: 'routine-updated', text: `Routine updated: ${r.name} · ${r.enabled ? r.description : 'Paused'}`, ref: r.id });
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: JSON.stringify({ ok: true, routine: r }) };
    },
  },
  {
    name: 'delete_routine',
    description: 'Delete one of your routines.',
    parameters: obj({ routine_id: { type: 'string' } }, ['routine_id']),
    activity: 'working',
    label: 'Removing a routine',
    impl: async (a, ctx) => {
      unscheduleRoutine(a.routine_id);
      db.prepare('DELETE FROM routines WHERE id=? AND bot_id=?').run(a.routine_id, ctx.botId);
      hub.emit(ctx.userId, { type: 'routines', botId: ctx.botId });
      return { output: 'Deleted.' };
    },
  },
  {
    name: 'plan',
    description: 'For work with several steps: write the plan first (create), then mark each step as you go (mark_step: doing, done or blocked). The user sees it as a checklist in Tasks. Skip it for quick questions.',
    parameters: obj({
      command: { type: 'string', enum: ['create', 'mark_step', 'get', 'close'] },
      title: { type: 'string', description: 'create: what the plan achieves' },
      steps: { type: 'array', items: { type: 'string' }, description: 'create: the steps, in order' },
      step_index: { type: 'integer', description: 'mark_step: 0-based step number' },
      status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
      note: { type: 'string', description: 'mark_step: a short result or the reason it is blocked; close: why' },
    }, ['command']),
    activity: 'working',
    label: 'Planning',
    impl: async (a, ctx) => {
      const tell = () => hub.emit(ctx.userId, { type: 'tasks', botId: ctx.botId });
      if (a.command === 'create') {
        if (!a.title || !Array.isArray(a.steps) || a.steps.length < 2) return { output: 'create needs a title and at least 2 steps.' };
        const old = activePlan(ctx.botId);
        const p = createPlan(ctx.botId, String(a.title), a.steps);
        if (old) db.prepare("UPDATE tasks SET state='done', note=?, updated_at=? WHERE id=?").run('Replaced by a new plan.', now(), old.id);
        tell();
        return { output: (old ? `The earlier plan "${old.title}" was closed.\n` : '') + render(String(a.title), p.steps) + '\nWork on the step marked [→], then call mark_step.' };
      }
      const plan = activePlan(ctx.botId);
      if (!plan) return { output: 'There is no active plan. Use create first.' };
      if (a.command === 'close') {
        db.prepare("UPDATE tasks SET state='done', note=?, updated_at=? WHERE id=?").run(String(a.note ?? 'Closed.'), now(), plan.id);
        tell();
        return { output: `Plan "${plan.title}" closed.` };
      }
      if (a.command === 'mark_step') {
        const r = markStep(plan.steps, Number(a.step_index), String(a.status ?? 'done'), a.note);
        if (r.error) return { output: r.error };
        const state = saveSteps(plan.id, r.steps);
        tell();
        return { output: render(plan.title, r.steps) + (state === 'done' ? '\nAll steps are done. Tell the user the result.' : '') };
      }
      return { output: render(plan.title, plan.steps) };
    },
  },
  {
    name: 'create_task',
    description: 'Track a piece of work the user asked for as a task (use one per request when asked for several things at once).',
    parameters: obj({ title: { type: 'string' } }, ['title']),
    activity: 'working',
    label: 'Making a task',
    impl: async (a, ctx) => {
      const id = newId('task');
      db.prepare("INSERT INTO tasks(id,bot_id,title,state,created_at,updated_at) VALUES (?,?,?,'working',?,?)").run(id, ctx.botId, a.title, now(), now());
      hub.emit(ctx.userId, { type: 'tasks', botId: ctx.botId });
      return { output: JSON.stringify({ task_id: id }) };
    },
  },
  {
    name: 'update_task',
    description: 'Update a task: state is working, needs_input, or done.',
    parameters: obj({ task_id: { type: 'string' }, state: { type: 'string', enum: ['working', 'needs_input', 'done'] }, note: { type: 'string' } }, ['task_id', 'state']),
    activity: 'working',
    label: 'Updating a task',
    impl: async (a, ctx) => {
      db.prepare('UPDATE tasks SET state=?, note=COALESCE(?, note), updated_at=? WHERE id=? AND bot_id=?').run(a.state, a.note ?? null, now(), a.task_id, ctx.botId);
      hub.emit(ctx.userId, { type: 'tasks', botId: ctx.botId });
      return { output: 'Updated.' };
    },
  },
  {
    name: 'create_issue',
    description: "Create an issue (a unit of work) and optionally assign it to another Bot by name; they are woken up to do it and you are told when it is done. Pass parent_id to split a bigger issue you hold into sub-issues.",
    parameters: obj({ title: { type: 'string' }, details: { type: 'string' }, assignee: { type: 'string', description: 'Bot name; omit to leave unassigned' }, parent_id: { type: 'string' }, goal_id: { type: 'string', description: 'The goal this work serves (see list_my_goals)' } }, ['title']),
    activity: 'messaging_named',
    label: 'Creating an issue',
    impl: async (a, ctx) => {
      let assigneeBotId: string | null = null;
      if (a.assignee) {
        const t = botByName(ctx.userId, a.assignee);
        if (!t || t.kind === 'room') return { output: `No bot named "${a.assignee}".` };
        assigneeBotId = t.id;
      }
      try {
        const i = createIssue({ userId: ctx.userId, title: String(a.title), body: a.details, assigneeBotId, parentId: a.parent_id, goalId: a.goal_id, createdByBotId: ctx.botId });
        return { output: JSON.stringify({ issue_id: i.id, assigned_to: a.assignee ?? null }), summary: `Issue: ${i.title}` };
      } catch (e: any) { return { output: e.message }; }
    },
  },
  {
    name: 'list_my_goals',
    description: 'The goals you own. Tie issues you create to them with goal_id so progress shows on the goal.',
    parameters: obj({}, []),
    activity: 'working',
    label: 'Checking my goals',
    impl: async (_a, ctx) => ({ output: JSON.stringify(goalsFor(ctx.botId)) }),
  },
  {
    name: 'list_my_issues',
    description: 'Issues assigned to you that are not finished.',
    parameters: obj({}),
    activity: 'working',
    label: 'Checking my issues',
    impl: async (_a, ctx) => ({ output: JSON.stringify(issuesFor(ctx.botId).map((i) => ({ id: i.id, title: i.title, status: i.status, details: i.body }))) }),
  },
  {
    name: 'checkout_issue',
    description: 'Take an issue before working on it. Only one Bot can hold an issue; if this fails, leave it alone.',
    parameters: obj({ issue_id: { type: 'string' } }, ['issue_id']),
    activity: 'working',
    label: 'Taking an issue',
    impl: async (a, ctx) => { const r = checkout(String(a.issue_id), ctx.botId); return { output: r.ok ? `Checked out: ${r.issue.title}` : `Cannot check out: ${r.reason}` }; },
  },
  {
    name: 'complete_issue',
    description: 'Finish an issue you hold, with a short result. Whoever created it is told.',
    parameters: obj({ issue_id: { type: 'string' }, result: { type: 'string' } }, ['issue_id', 'result']),
    activity: 'working',
    label: 'Finishing an issue',
    impl: async (a, ctx) => { const r = finish(String(a.issue_id), ctx.botId, 'done', String(a.result)); return { output: r.ok ? 'Done.' : `Cannot complete: ${r.reason}` }; },
  },
  {
    name: 'comment_issue',
    description: 'Add a note to an issue (a question, progress, a decision). The assignee and creator are told. Without text, returns the existing comments instead.',
    parameters: obj({ issue_id: { type: 'string' }, text: { type: 'string' } }, ['issue_id']),
    activity: 'working',
    label: 'Commenting on an issue',
    impl: async (a, ctx) => {
      if (!a.text) return { output: JSON.stringify(listComments(ctx.userId, String(a.issue_id)).map((c) => ({ by: c.author, text: c.text }))) };
      const r = addComment(ctx.userId, String(a.issue_id), ctx.botId, String(a.text));
      return { output: r.ok ? 'Added.' : `Cannot comment: ${r.reason}` };
    },
  },
  {
    name: 'block_issue',
    description: 'Mark an issue you hold as blocked, saying what you need. Whoever created it is told.',
    parameters: obj({ issue_id: { type: 'string' }, reason: { type: 'string' } }, ['issue_id', 'reason']),
    activity: 'working',
    label: 'Blocking an issue',
    impl: async (a, ctx) => { const r = finish(String(a.issue_id), ctx.botId, 'blocked', String(a.reason)); return { output: r.ok ? 'Marked blocked.' : `Cannot block: ${r.reason}` }; },
  },
  {
    name: 'list_workflows',
    description: "List the user's saved multi-agent workflows (name, steps, which Bot runs each).",
    parameters: obj({}),
    activity: 'working',
    label: 'Looking at workflows',
    impl: async (_a, ctx) => {
      const { listFlows } = await import('../routes-flows.js');
      return { output: JSON.stringify(listFlows(ctx.userId).map((f) => ({ id: f.id, name: f.name, schedule: f.schedule || null, steps: f.steps.map((s) => ({ id: s.id, bot: s.bot, needs: s.needs ?? [] })) }))) };
    },
  },
  {
    name: 'run_workflow',
    description: 'Start a saved workflow by name or id, with optional input text ({{input}} in its steps). It runs in the background; steps run on their Bots in parallel where possible. Returns a run id.',
    parameters: obj({ workflow: { type: 'string' }, input: { type: 'string' } }, ['workflow']),
    activity: 'messaging_named',
    label: 'Starting a workflow',
    impl: async (a, ctx) => {
      if (ctx.depth >= 4) return { output: 'Too many hops between bots; answer the user directly instead.' };
      const { findFlow, startFlowRun } = await import('../routes-flows.js');
      const f = findFlow(ctx.userId, String(a.workflow));
      if (!f) return { output: `No workflow "${a.workflow}". Use list_workflows.` };
      try { return { output: JSON.stringify({ run_id: startFlowRun(ctx.userId, f.id, String(a.input ?? '')) }), summary: `Started workflow ${f.name}` }; }
      catch (e: any) { return { output: e.message }; }
    },
  },
  {
    name: 'create_bot',
    description: "Hire a new Bot (teammate) with its own role, instructions, browser and memory. Use it when work needs a specialist or should run in parallel, e.g. a 'Listing Bot' for Amazon, a 'Pinterest Bot', a 'Research Bot'. Group Bots into a company with the company field. Then give it work with send_to_bot. Check list_bots first so you do not create duplicates.",
    parameters: obj({
      name: { type: 'string', description: 'Short unique name, e.g. "Amazon Lister"' },
      role: { type: 'string', description: 'Job title, e.g. "Amazon product listing"' },
      company: { type: 'string', description: 'Company / department this Bot belongs to, e.g. "Dropship Co"' },
      instructions: { type: 'string', description: 'What this Bot does, step by step, and what to report back. Tell it to use its own browser for websites.' },
    }, ['name', 'instructions']),
    activity: 'working',
    label: 'Hiring a Bot',
    impl: async (a, ctx) => {
      if (botByName(ctx.userId, String(a.name))) return { output: `A Bot named "${a.name}" already exists. Use send_to_bot, or pick another name.` };
      try {
        const { createBot } = await import('../routes.js');
        const label = [a.company, a.role].filter(Boolean).join(' · ');
        const b = createBot(ctx.userId, { name: String(a.name), label, description: String(a.role ?? ''), instructions: `${a.instructions}\n\nYou are part of ${a.company || "the user's"} team. When you finish, reply to whoever asked with send_to_bot, short and with the result.` });
        return { output: JSON.stringify({ ok: true, name: b.name, hint: 'Now give it work with send_to_bot.' }), summary: `Hired ${b.name}` };
      } catch (e: any) { return { output: e.message }; }
    },
  },
  {
    name: 'list_bots',
    description: 'List every Bot on the team with its company/role.',
    parameters: obj({}),
    activity: 'working',
    label: 'Checking the team',
    impl: async (_a, ctx) => ({ output: (db.prepare("SELECT name, label, is_primary FROM bots WHERE user_id=? AND COALESCE(kind,'agent')<>'room' AND COALESCE(hidden,0)=0 ORDER BY created_at").all(ctx.userId) as any[]).map((b) => `- ${b.name}${b.label ? ` (${b.label})` : ''}${b.is_primary ? ' [main]' : ''}`).join('\n') }),
  },
  {
    name: 'send_to_bot',
    description: "Send a message to another Bot on the user's team (by name) to delegate work or ask a question. Their reply will arrive later as a new message to you.",
    parameters: obj({ bot_name: { type: 'string' }, message: { type: 'string' } }, ['bot_name', 'message']),
    activity: 'messaging_named',
    label: 'Messaging a Bot',
    impl: async (a, ctx) => {
      const target = botByName(ctx.userId, a.bot_name);
      if (!target) return { output: `No bot named "${a.bot_name}". Team: ${(db.prepare('SELECT name FROM bots WHERE user_id=?').all(ctx.userId) as any[]).map((b) => b.name).join(', ')}` };
      if (target.id === ctx.botId) return { output: 'That is you.' };
      if (target.kind === 'room') return { output: `"${target.name}" is a group chat; use post_to_group instead.` };
      if (ctx.depth >= 4) return { output: 'Too many hops between bots; answer the user directly instead.' };
      ctx.enqueueBotMessage(ctx.botId, target.id, String(a.message), ctx.depth + 1);
      return { output: `Sent to ${target.name}. Their reply will come back to you as a message.`, summary: `Messaged ${target.name}` };
    },
  },
  {
    name: 'create_group',
    description: "Create a group chat between the user and several Bots on the team (by name). It appears in the user's sidebar; when the user posts there, the relevant Bots answer.",
    parameters: obj({ name: { type: 'string' }, bot_names: { type: 'array', items: { type: 'string' } } }, ['name', 'bot_names']),
    activity: 'working',
    label: 'Setting up a group',
    impl: async (a, ctx) => {
      const ids: string[] = [];
      const missing: string[] = [];
      for (const n of (a.bot_names ?? []) as string[]) {
        const b = botByName(ctx.userId, n);
        if (b && b.kind !== 'room') ids.push(b.id); else missing.push(n);
      }
      if (ids.length < 2) return { output: `A group needs at least 2 Bots. Not found: ${missing.join(', ') || 'none'}.` };
      const id = createRoom(ctx.userId, String(a.name), [...new Set(ids)]);
      appendRow(id, 'event', { type: 'event', event: 'bot-message', text: `Group created with ${(a.bot_names as string[]).filter((n) => !missing.includes(n)).join(', ')}` });
      return { output: JSON.stringify({ ok: true, group_id: id, missing }), summary: `Created group ${a.name}` };
    },
  },
  {
    name: 'post_to_group',
    description: 'Post a message into a group chat you are a member of.',
    parameters: obj({ group_name: { type: 'string' }, text: { type: 'string' } }, ['group_name', 'text']),
    activity: 'messaging_named',
    label: 'Posting to the group',
    impl: async (a, ctx) => {
      const out = postToRoom(ctx.botId, String(a.group_name), String(a.text));
      return { output: out, summary: `Posted to ${a.group_name}`, endTurn: out === 'Posted to the group.' };
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a multiple-choice question when you need a decision before continuing. Ends your turn; their answer arrives as their next message.',
    parameters: obj({ question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, ['question', 'options']),
    activity: 'waiting_for_you',
    label: 'Waiting on you',
    impl: async (a, ctx) => {
      appendRow(ctx.botId, 'card', { type: 'card', card: 'question', question: a.question, options: (a.options ?? []).slice(0, 6), status: 'pending' });
      return { output: 'Question shown to the user. Stop here and wait for their answer.', endTurn: true };
    },
  },
  {
    name: 'request_app_connection',
    description: 'Ask the user to connect an app (slug such as github, slack, notion, browser, filesystem) so you can use it.',
    parameters: obj({ toolkit: { type: 'string' }, reason: { type: 'string' } }, ['toolkit', 'reason']),
    activity: 'connecting_service',
    label: 'Using a connected app',
    impl: async (a, ctx) => {
      const info = appInfo(String(a.toolkit).toLowerCase());
      if (!info) return { output: `Unknown app "${a.toolkit}". Ask the user which app they mean.` };
      appendRow(ctx.botId, 'card', { type: 'card', card: 'connect', toolkit: info.slug, toolkitName: info.name, reason: a.reason, status: 'pending' });
      return { output: `Asked the user to connect ${info.name}. Stop here; you'll be told when it's connected.`, endTurn: true };
    },
  },
];

export const toolMap = new Map(TOOLS.map((t) => [t.name, t]));

// ---------- approvals policy ----------

export type Decision = 'allow' | 'ask' | 'block';

export function policyFor(userId: string, toolName: string, _args: any): { decision: Decision; key: string; toolkit?: string; title: string } {
  if (toolMap.has(toolName)) return { decision: 'allow', key: toolName, title: toolName };
  const tool = cachedAppTool(toolName);
  const toolkit = tool?.slug ?? toolName.split('__')[0];
  const title = humanizeTool(toolName);
  const p = db.prepare('SELECT mode FROM policies WHERE user_id=? AND tool=?').get(userId, toolName) as any;
  const mode = p?.mode ?? (tool?.readOnly ? 'always_allow' : 'needs_approval');
  return { decision: mode === 'blocked' ? 'block' : mode === 'always_allow' ? 'allow' : 'ask', key: toolName, toolkit, title };
}

export async function runAppTool(_ctx: ToolCtx, name: string, args: any): Promise<ToolResult> {
  const t = await findAppTool(name);
  if (!t) return { output: `No connected app has a tool named ${name}.`, summary: 'failed' };
  try { return { output: await t.run(args), summary: 'done' }; }
  catch (e: any) { return { output: `Tool error: ${e?.message ?? e}`, summary: 'failed' }; }
}

export const humanizeSlug = (key: string) => humanizeTool(key);

/** A Hermes tool name as the app knows it: tools served by this app's MCP server lose their `mcp_hq_` prefix. */
export function appToolName(raw: string): { name: string; ours: boolean; server?: string } {
  const hq = /^mcp_+hq_+(.+)$/.exec(raw);
  if (hq) {
    // Hermes may fold names to lower case; ours are matched case-insensitively.
    const hit = [...toolMap.keys()].find((k) => k.toLowerCase() === hq[1].toLowerCase());
    return { name: hit ?? hq[1], ours: true };
  }
  const other = /^mcp_+([a-zA-Z0-9-]+?)_+(.+)$/.exec(raw);
  if (other) return { name: other[2], ours: false, server: other[1] };
  return { name: raw, ours: false };
}

const words = (s: string) => s.replace(/[_-]+/g, ' ').trim();
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What to show while a tool runs. `raw` is the name Hermes reports. */
export function activityFor(raw: string): { kind: ActivityKind; label: string; detail?: string } {
  const { name, ours, server } = appToolName(raw);
  if (ours) {
    const t = toolMap.get(name);
    if (t) return { kind: t.activity, label: t.label,  };
    return { kind: 'connecting_service', label: 'Using a connected app' };
  }
  if (server) return { kind: 'connecting_service', label: `Using ${words(server)}`, detail: sentence(words(server)) };
  if (name === 'terminal' || name === 'process' || name === 'execute_code') return { kind: 'running_commands', label: 'Running commands' };
  if (name === 'write_file' || name === 'patch') return { kind: 'drafting_file', label: 'Writing a file' };
  if (name === 'read_file' || name === 'search_files') return { kind: 'working', label: 'Reading files' };
  if (name === 'web_search') return { kind: 'searching_web', label: 'Searching the web' };
  if (name === 'web_extract') return { kind: 'reading_web', label: 'Reading a page' };
  if (name.startsWith('browser_')) return { kind: 'browsing_web', label: 'Browsing a site' };
  if (name === 'computer_use') return { kind: 'on_its_computer', label: 'Using its computer' };
  if (name === 'vision_analyze') return { kind: 'working', label: 'Looking at an image' };
  if (name === 'memory') return { kind: 'remembering', label: 'Saving notes' };
  if (name === 'session_search') return { kind: 'remembering', label: 'Searching memory' };
  if (name === 'todo') return { kind: 'working', label: 'Planning' };
  if (name === 'delegate_task') return { kind: 'working', label: 'Handing off work' };
  if (name === 'send_message') return { kind: 'messaging_named', label: 'Sending a message' };
  if (name.startsWith('skill')) return { kind: 'working', label: 'Using a skill' };
  if (name === 'clarify') return { kind: 'waiting_for_you', label: 'Waiting on you' };
  if (name === 'cronjob') return { kind: 'working', label: 'Scheduling' };
  return { kind: 'working', label: sentence(words(name)) || 'Working' };
}

export function getBotName(botId: string) {
  return getBotRow(botId)?.name ?? 'Bot';
}
