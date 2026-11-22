# Krishbot AI — Handoff

Goal: one free, local-only app ("Krishbot AI — Mera AI"). No cloud server, no paid APIs.
Look and UI: the bot-hq UI (Grok Bot style: left roster, centre chat with "Worked for…" chips, right panel with screen/Activity/Tasks/Library/Engine). Keep it.
Licenses: do NOT add third-party licenses yet (owner will add later). About section must not show license/credit links.

## Sources
- base: bot-hq-main.zip (this repo)
- features to port: milind-soni/OpenMausBot, CopilotKit/OpenBot, FoundationAgents/OpenManus

## Rule per part
1. Before starting: diff the previous part's checklist against the code; fix anything missed.
2. Do the part, build/typecheck, commit, push.
3. Tick the checklist below and update the Status section.

## Analysis (read from all repos)
bot-hq (base, keep UI + features): Hono+SQLite server, React web. Every bot = a Hermes agent reached via POST {engine}/v1/responses (server/src/agent/loop.ts, engine.ts); app tools reach it over MCP (mcp.ts, agent/tools.ts). Cloud coupling: Orgo (orgo.ts, computer.ts, desk.ts, vnc.ts, box.ts), Composio (composio.ts, triggers.ts), xAI (voice.ts, x_search), Hermes (engine*.ts).
OpenMausBot (milind-soni, Apache-2.0): drivers/ (ProviderDriver iface, openai-compat.ts, ollama.ts, ~31 engines), model-catalog/presets.ts (provider presets: OpenRouter, Groq, Cerebras, Mistral, DeepSeek, Fireworks...), model-manifest, rooms/groups, handoff cards, skills, routines UI, MCP panel, phone relay (phone-protocol, companion/), bubblewrap sandbox.
OpenManus (FoundationAgents): app/tool/* (bash, python_execute, str_replace_editor, browser/crawl4ai, web_search, planning, ask_human, mcp), agent/ (manus, toolcall, react), flow/planning.py, config.example.toml (any OpenAI-compatible base_url incl. Ollama).
OpenBot (CopilotKit): AG-UI agent protocol, many agent adapters, MCP tools, approvals/interactive results, extension, desktop (Tauri), mobile.
"ChatGPT 6 Luna": only in OpenMausBot codex-catalog.ts as a Codex-CLI model (needs ChatGPT login) - not free by itself. Free path: built-in openai-compat engine with free-tier providers.

## Key design decision
Replace Hermes+Orgo+Composio+xAI with ONE built-in Node "Krishbot engine" inside the server:
- agent loop (OpenManus-style tools: shell, python, file edit, browser, web search, planning) calling any OpenAI-compatible endpoint (Ollama/LM Studio local, plus free-tier providers from OpenMausBot presets). Same /v1/responses-shaped stream so loop.ts/UI stay untouched.
- local "screen" = local headless browser screenshots + terminal (no VNC cloud).
- MCP client (stdio+HTTP) for connectors; approvals reuse bot-hq cards.
- phone control = same server over LAN + QR pairing, PWA.

## Connectors / channels (from owner's latest message, must be done)
- OpenMausBot runs Composio-style connectors (server/composio*.ts, connector-*.ts, chat-apps-mcp.ts, connector/) with 180-1000+ apps (YouTube, Facebook, Instagram...). Goal: all of it works LOCAL, no hosted broker/cloud server. Plan: (a) generic local MCP client + big MCP server catalog (stdio via npx, HTTP) in P4, (b) Composio only if user pastes own free key (optional), (c) port OpenMausBot's catalog/UI.
- WhatsApp (and other chat apps/phones) integration: port from OpenMausBot (server/phones, chat-apps) in P5/P6; check OpenBot + OpenManus too for anything missing, copy code over.
- Also check OpenBot repo and OpenManus for missing features; copy-paste them in (P7/P8).
- Free default model: Pollinations (no key, tool calls verified) + Ollama local + free-tier providers. OpenCode Zen free hit usage limit (not usable anonymously).
- After EVERY part: update this handoff, push.

## Parts
- [x] P0 baseline imported (bot-hq as-is)
- [x] P1 Rebrand to Krishbot (name is exactly "Krishbot"); Orgo/Composio/xAI keys now optional (server boots with none); no sign-in screen (loopback auto-login as owner); session secret auto-generated in ~/.krishbot. NOTE: Hermes/Orgo/Composio code still present - removed in P2/P3/P4 as replaced
- [x] P2 (DONE, verified e2e: free model -> terminal tool -> approval card -> result 'krish-42') Local engine: Ollama + OpenAI-compatible (LM Studio, llama.cpp) + free providers; model picker with many models; no key needed to start
- [x] P3 (DONE) Local computer/screen per bot (replace Orgo): local browser (Playwright/CDP) + shell, watch / take control
- [x] P4 (DONE, verified e2e) Local connectors: MCP client (stdio + HTTP) in server/src/apps.ts, 39-app catalog, custom MCP / web-API apps, per-tool approvals, webhook routines; Composio removed
- [x] P5 (DONE, verified) Phone remote control: QR pairing, LAN + free cloudflared tunnel, installable PWA, phone layout, device list/revoke
- [x] P6 (DONE, partly verified) Resilient model calls + provider fallback, OpenRouter preset (free + GPT-6 Luna/Astra), WhatsApp bridge
- [x] P7 (DONE, verified) OpenManus: `plan` tool (checklist in Tasks), stuck-loop nudge
- [x] P8 (DONE, tested) OpenBot ideas: dangerous-action guard, audit log, secret redaction
- [x] P9a free browser voice
- [x] P9b MCP registry search (thousands of connectors, all local)
- [x] P9c polish: breaker, audit viewer, launcher, README, Windows path fix
- [x] P10 cross-check done (see P10 notes)

## Status
P0-P10 done. Server boots with zero keys (verified). Remaining ideas: see P10 notes.

## P2 notes (for next agent)
- server/src/engine.ts is now a slim replacement (old Hermes engine deleted). Every bot -> in-process engine at /krish/v1/responses (server/src/krish/engine.ts), guarded by engineKey().
- krish/providers.ts: presets (Pollinations keyless default, Ollama, LM Studio, llama.cpp, OpenRouter, Groq, Cerebras, Gemini, Mistral, Together, DeepSeek, OpenAI, custom). Keys saved to ~/.krishbot/providers.json. REST: GET/PUT /api/krish/providers.
- krish/tools.ts: terminal, execute_code, read_file, write_file, patch, search_files, web_search (DuckDuckGo), web_extract, memory. Write/exec tools go through approval cards (policy key local:<tool>).
- krish/mcp-client.ts is a STUB -> implement in P4.
- App tools still come from agent/tools.ts via mcp.ts listTools/callTool (exported).
- Still TODO from Hermes era: routes-config.ts engine/login + screen routes (dead), Composio calls (401 warnings in log), 'Add to Slack' suggestion, x_search/xAI, voice.ts (xAI) -> P4/P9.
- Typecheck needs NODE_OPTIONS=--max-old-space-size=1400 (swap enabled). Web build: npx vite build in web/.

## P3 notes
- Orgo/VNC/desk/box scripts deleted. Each bot gets its own Chrome (headless, CDP) on THIS computer: server/src/screen/{cdp,manager,tools,relay}.ts. Profile: ~/.krishbot/profiles/<bot> (logins persist). Library: ~/.krishbot/library/<bot>.
- Needs Chrome/Chromium/Edge installed (CHROME_PATH to override; KRISH_HEADFUL=1 shows a real window).
- Browser tools (OpenManus browser_use style, numbered elements): browser_navigate/snapshot/click/type/key/scroll/back/eval(ask).
- Live view: WS /api/bots/:id/screen?mode=watch|control streams JPEG frames (CDP screencast); control mode sends mouse/key/wheel/text JSON. Web viewer = canvas in ComputerViewer.tsx (noVNC removed). GET /api/bots/:id/screenshot returns a JPEG.
- computer.ts is a thin local shim (status always 'running'). Settings 'Screens in use' list = running browsers.
- Verified: bot navigated example.com, answered title+link; WS frames flow.
- Not a full desktop (no OS-level mouse/keyboard). OS control could be added in P5 if needed.

## Takeover 2026-11-22 (new agent)
- Read: this handoff, the old Krishbot repo (`DeepuExplainsAi/Krishbot`, branch `full-port`: has local `apps.ts` MCP catalog and `triggers.ts` webhook routines, reused here), owner's video (previous AI stopped in P4 while removing Composio; nothing of that was pushed, Composio code is still in `composio.ts`, `mcp.ts`, `triggers.ts`, `agent/*`, `routes.ts`, web modal).
- Owner's extra requirements (from docx): WhatsApp integrated; phone remote control; best error handling (provider/API failures: retry, fallback to next provider, clear messages) taken from the reference repos incl. paperclipai/paperclip; model list incl. "gpt-6-luna"-style ids preconfigured; look stays bot-hq/Grok Bot; no cloud; no license text in About (add later).
- Machine limits: 482 MB RAM, ~900 MB disk. Reference repos cloned under ~/ref (not committed).
- Order: P4 (local connectors, remove Composio) -> P5 -> ... as listed. Each part: re-check previous part first, push, update this file.

## P4 notes
- `server/src/apps.ts`: catalog (npx MCP servers; fields = keys typed in the UI, stored in the local DB), custom MCP (command or URL) and custom web-API tools, MCP clients cached per app. Tools are named `<slug>__<tool>`; read-only (MCP annotation / GET) run directly, the rest ask via approval cards (`policyFor`). Hosted servers (Linear, Jira, Asana, PayPal, Webflow, Cloudflare) go through `mcp-remote`: a browser sign-in opens on this computer.
- `krish/mcp-client.ts` is now a thin wrapper over apps.ts; `krish/engine.ts` `runTool` applies the approval policy to connected-app tools.
- `triggers.ts`: event routines = webhook `POST /hooks/<secret>` (no cloud). `create_event_routine` tool returns the URL. Composio removed everywhere (server, web, deps, db table, env).
- Web: ConnectAppsModal has key forms, "Add your own" (MCP / web API), bot templates menu. Connect card opens the modal.
- Verified: memory MCP server via npx (list, call), custom HTTP tool, full chat loop with a fake OpenAI server -> approval card -> allow -> tool result, webhook routine fires, unknown secret 404.
- NOT verified: real third-party apps with real keys; `mcp-remote` browser sign-in; npm package names were checked to exist, not run (only `memory` was run).
- Catalog is 39 apps, not 180-1000+. Easy to extend: add a line in CATALOG. Idea for later: a "search npm / MCP registry" box that fills the custom form.
- Machine note: never run many `npm view` in parallel on this 482 MB VM (it froze the box).

## P5 notes
- `server/src/phone.ts`: `/api/phone` (laptop only: Host must be localhost AND peer loopback) -> pair (one-time 5-min code -> QR via `qrcode`), tunnel on/off (`cloudflared tunnel --protocol http2`, no account; QUIC is blocked on many networks), device list, revoke. `/pair/<code>` signs the phone in (cookie session with `device` + `last_seen` columns on auth_sessions).
- Security: auto local login now needs Host=localhost too (tunnel traffic arrives from 127.0.0.1 but with a trycloudflare Host, so it is NOT auto-logged-in; verified). `isSameOriginRequest` accepts Origin==Host for plain-http LAN (browsers send no Sec-Fetch-Site there). A paired phone cannot pair others.
- Web: Settings -> Phone (QR, tunnel, devices), `mobile.css` (<=760px: Bot list OR chat, back button, `mobileChat` in store), manifest + icons (PWA, "Add to Home screen").
- Verified with curl: LAN peer not auto-logged-in; pair -> cookie -> /api/bots; link single-use (410); revoke -> 401; forged Origin -> 403; tunnel end-to-end (pair + send chat over https trycloudflare URL).
- NOT verified: real phone browser rendering of mobile.css (no device here), push notifications, PWA install prompt, screen WebSocket from a phone, wake/sleep of the laptop (the laptop app must be open).
- Reference: ~/KRISH (separate Android app + relay) not merged; this web-PWA path needs no APK.

## P6 notes
- `server/src/krish/resilient.ts`: every model call goes through `callModel`: classify failure (rate limit / overloaded / network / timeout / auth / not found / too long / bad request), retry only before any output streamed (3 tries, exponential backoff with jitter, honours Retry-After, capped 20s, abortable), then fall back to the next READY provider (keyed ones first, keyless Pollinations last), and say so in chat (quiet info notice). Too-long and bad-request errors do not fall back. Final error names every provider tried, plain language. Tests: `server/test/resilient.test.mts` (npm test -w server). Verified live with a flaky fake provider (2x503 then OK).
- Idea taken from paperclip `database-retry.ts`: retry only what is safe to repeat, bounded attempts, walk the cause chain for error codes.
- Not done: mid-stream failure (after text started) is not retried, it is reported. Per-provider circuit breaker (skip a provider that failed recently) not done.
- Models: Pollinations (keyless) is the default. OpenRouter preset lists the 11 `:free` models that support tools plus openai/gpt-6-luna, gpt-6.2-astra, gpt-6.2-sol, gpt-5.6-luna, claude-fable-5.2, gemini-4-neon (these bill OpenRouter credit). HONEST NOTE: "ChatGPT 6 Luna" is not free anywhere; a free default with that name does not exist. It is selectable once an OpenRouter key is added.
- WhatsApp: `whatsapp-relay.ts` (pure logic, tested: allowlist, self-chat, own-message marker, approval replies 1/2/3, stop, errors) + `whatsapp.ts` (Baileys 7.0.0-rc14, QR link, reconnect with backoff, creds in ~/.krishbot/whatsapp) + Settings -> WhatsApp. Only the main Bot. Verified: server starts the socket and WhatsApp's servers return a real QR. NOT verified: actual scan/link, sending, receiving (needs a real phone). Baileys is unofficial; account-ban risk is noted in the UI/file header. Groups and media are ignored.
- Not done from OpenMausBot: rooms exist already; handoff cards, skills marketplace, multi-chat apps (Slack/Telegram) not ported.
- About section: the app has no About/license screen right now (checked web/src). LICENSE and THIRD_PARTY_NOTICES.md exist in repo root only; the user said they will add licenses later.

## P7 notes
- OpenManus already matched by existing local tools (terminal, execute_code, read/write/patch file, web_search/extract, browser). Added what was missing: `plan` tool (create / mark_step / get; `server/src/plan.ts`, tested) stored on `tasks.steps` (JSON), shown as a checklist in the Tasks tab; and OpenManus's "stuck" check (`loopNudge`): third identical tool call in a row gets a nudge appended to the result.
- Verified with a scripted fake model: plan created, step marked, state persisted, nudge fired.
- Not ported: OpenManus multi-agent PlanningFlow executor (a separate agent per step), crawl4ai, chart visualization, sandbox. The single-agent plan tool covers the planning value; a per-step executor would be a bigger change.

## P8 notes
- `server/src/danger.ts`: dangerous commands/paths (rm -rf /, curl|sh, force push, disk writes, ssh/key files) ask EVERY time, even after "Always allow"; the card says why. Tool output is redacted (API keys/tokens -> `[secret hidden]`) before it reaches the model or chat. Every tool run is appended to `~/.krishbot/audit.log` (JSON lines, local only, args redacted). Tests: `server/test/danger.test.mts`.
- Not ported from OpenBot: AG-UI protocol, Tauri desktop shell, other agent adapters (not needed for single-user local app).
- Pending UI idea: audit log viewer in Settings.

## P9a notes (voice)
- Voice is now fully free and local to the browser: `web/src/voice/speech.ts` (Web Speech recognition + speechSynthesis), `call.ts` (hands-free loop: listen -> send as normal message -> read the reply aloud, announces approvals), `dictation.ts` (mic in composer). xAI realtime/STT/TTS server code deleted (`server/src/voice.ts` only lists languages/speeds); `x_search` and XAI env removed.
- Needs Chrome/Edge/Safari (Firefox has no speech recognition: shows a clear message). Chrome's recognition uses Google's service online; offline voice would need a local Whisper (not done).

## P9b notes (connectors)
- `GET /api/apps/registry?q=` searches the official MCP registry (registry.modelcontextprotocol.io) and returns installable hits: npm -> `npx -y`, pypi -> `uvx`, or a streamable-http remote URL; env vars / headers become key fields. Web: "Find more (MCP registry)" section in Connect Apps; Install calls the existing `/apps/custom`. Verified live: youtube 39 hits, github 37, instagram 40.
- Combined with the 39 curated apps this covers the "1000+ connectors" goal without any hosted broker. Needs internet only to search; installs run locally.
- Not verified: starting a registry server that needs `uvx` (uv not guaranteed on the user's PC); remote servers that need OAuth.
- Chrome screenshot of the UI could not be taken on the 482 MB build VM (Chrome timed out); the web build + API were checked with curl instead. Owner should open it once on the laptop.

## P9c notes
- `krish/breaker.ts`: provider skipped 60s after 2 fallback-worthy failures (not when it is the last choice). Tests in `test/breaker.test.mts`.
- Settings -> Activity log (`/api/audit`, reads `~/.krishbot/audit.log`).
- Launcher: `Krishbot.bat` / `Krishbot.command` / `krishbot.sh` -> `scripts/launch.mjs` (install, build, start, open browser). Verified on Linux with curl; not run on Windows/Mac.
- Fixed `import.meta.url.pathname` (broke on Windows paths) with `fileURLToPath`.
- Deleted the Orgo/Hermes install scripts and docs. `docs/ARCHITECTURE.md` still describes the old design: rewrite in P10.

## P10 notes (final cross-check, 2026-11-22)
- Re-tested with a real server + scripted fake model (HOME=/tmp): chat on keyless Pollinations -> reply; custom provider -> tool call -> approval card -> allow -> result with key redacted; "Always allow" then safe command runs silently; `rm -rf /` still asks (card says why); deny -> declined in audit log. Launcher: build + start + /api/health + /api/audit OK. 27 server tests pass; server + web typecheck clean.
- Docs rewritten for the local design (README, ARCHITECTURE, SECURITY). Old Orgo/Hermes scripts, docs and e2e scripts deleted.
- No third-party licence text anywhere in the UI (as requested); LICENSE + THIRD_PARTY_NOTICES.md stay in the repo root only.
- STILL NOT VERIFIED (needs the owner's machine): real phone browser, WhatsApp scan with a real phone (verified on the VM: start -> real QR code generated, 7.5 KB data URL), Windows/Mac launcher, voice in a real browser (Web Speech), real third-party connector with real key, `uvx`-based registry servers, visual check of the UI (build VM too small for Chrome).
- NOT DONE (honest list): offline speech (local Whisper); multi-agent PlanningFlow from OpenManus; Slack/Telegram chat apps (only WhatsApp); skills marketplace and handoff cards from OpenMausBot; Paperclip org-chart/budget features; mid-stream failure retry. "ChatGPT 6 Luna" is not free (OpenRouter credit), only listed in the OpenRouter preset.

## P11a: danger mode is a user setting
- Settings -> Permissions -> "Risky actions": **Always ask me** (default: danger.ts patterns ask every time, even after "Always allow") or **Follow "Always allow"** (guard off). Stored in kv `danger_mode`; API `GET/PUT /api/audit/danger-mode`. Verified live: ask mode -> risky command asked and declined; follow mode -> same command ran with no new card. Redaction and audit log stay on in both modes.
- NEXT (owner's latest request): port remaining OpenManus (PlanningFlow with per-step executors), OpenMausBot (skills, handoff cards, Telegram/Slack), Paperclip (agent task assignment, org/delegation, heartbeats, budgets) and an n8n-style multi-agent workflow runner; re-test unverified items; finish with a full test suite run.

## P11b: multi-agent workflows (n8n / OpenManus PlanningFlow style)
- `server/src/flow.ts`: pure DAG scheduler. Steps have `needs`; ready steps run in parallel (cap 3), `{{input}}`/`{{step}}` templating, per-step retries (0-3), failure skips only downstream, stop signal, cycle/unknown-need validation. 7 unit tests (`test/flow.test.mts`).
- `server/src/routes-flows.ts`: tables `flows`, `flow_runs`; `/api/flows` (list, PUT, delete, run, runs, stop). A step = a message to a real bot, answer read after its queue drains; bot errors become the step error.
- UI: Settings -> Workflows (editor, run, live per-step status).
- Verified live with scripted fake model: fork/join (2 parallel + merge) gave correct merged output; a 400 from the provider failed step a with the friendly message and skipped b; unknown bot rejected at save.
- Found while testing: when the chosen provider is dead, the bot falls back to Pollinations (works; takes ~60s with retries).
- NOT DONE: bot tool to start a workflow from chat; cron-triggered flows; step-level approval cards appear in each bot's own chat (a flow waits on them).

## P11c: Paperclip-style issues (delegation between bots)
- `server/src/issues.ts` + `routes-issues.ts` (`/api/issues`) + Settings -> Issues. Table `issues`: assignee, created_by, parent_id (sub-issues), checkout_bot, result.
- Atomic checkout = one conditional UPDATE (only assignee/first claimer wins; others get a reason). Only the holder can complete/block; a parent can't complete while sub-issues are open; last sub-issue done nudges the parent's owner. Creator is woken with the result.
- Heartbeat (every 60s, per-issue 10 min): idle assignee that never checked out gets nudged again. User reassign/status change releases checkout. Cap: 40 open bot-created issues (stops runaway delegation).
- Bot tools: create_issue, list_my_issues, checkout_issue, complete_issue, block_issue (+ prompt lines).
- 8 unit tests (`test/issues.test.mts`). Live: Boss bot -> create_issue(Worker) -> Worker woken, checkout, complete -> Boss received the result. (Test-only gotcha: ids contain `-`.)
- NOT DONE: budgets/cost tracking, goals tree, issue comments.

## P11d: usage + daily token budget per bot (Paperclip budgets)
- `server/src/usage.ts`: table `usage_daily`; tokens from the provider's `usage` or ~4 chars/token estimate; `kv budget:<botId>` cap. Engine checks the cap before every model call and shows a friendly notice instead. API: `GET/PUT /api/bots/:id/budget`, `GET /api/usage` (7-day per-bot summary). UI: Engine panel row (today + limit).
- Tests: `test/usage.test.mts` (3). Live: usage recorded, cap 10 blocked the next message with the notice, removing the cap restored replies, negative cap rejected.
- Money cost is not tracked (providers here are free/BYO key); tokens only.

## P11e: shipped skills (OpenMausBot manifest format)
- `server/skills/<id>/{manifest.json,SKILL.md}`: social-posts, verify-project, research-report, daily-brief (written for Krishbot; OpenMausBot's own skills depend on its show_html/publish/phone tools, which don't exist here, so they were not copied).
- `server/src/skill-library.ts`: loader (bad skills skipped), trigger-term match, max 3 per turn, injected into the system prompt in `krish/engine.ts`; on/off in kv `skill:<id>`; API `/api/skill-library`; UI Settings -> Skills.
- Tests `test/skills.test.mts` (3). Live: triggered message gets the skill text, other message doesn't, off switch removes it.

## P11f: Telegram (second chat app, after WhatsApp)
- `server/src/telegram.ts`: plain HTTPS long-polling of the Bot API (no library, no webhook, nothing hosted), reuses `whatsapp-relay` (replies, approval cards 1/2/3, errors, stop). Access: a chat is allowed only after `/pair <one-time code>` from Settings -> Telegram; groups ignored; strangers get nothing. Token in local kv (`tg_token`). API `/api/telegram` (status, token, pair-code, start, stop, unlink). Backoff on network errors, 401 -> clear message.
- Tests `test/telegram.test.mts` (3). Live against a fake Telegram server (`KRISH_TELEGRAM_API` overrides the URL): bad token format rejected, wrong token -> 'rejected', good token -> running, stranger ignored, wrong code refused, right code paired, then the bot answered.
- NOT VERIFIED: real Telegram servers / a real BotFather token. Slack/Discord not done (OpenMausBot's Slack is hosted-admin based, not portable).

## P11g: workflows from chat + cron (2026-11-22)
- Bot tools `list_workflows`, `run_workflow` (name or id, optional input; hop-depth guarded). Flows have an optional cron `schedule` (editor field, validated on save, `initFlowSchedules` at boot, overlapping runs skipped).
- Tests `test/flows-schedule.test.mts` (3). Total 54 pass; typecheck and web build clean. Server boots with `[flows] scheduled 0`.
- NOT verified live: scheduled run firing on a real clock; run_workflow through a real model (auth wall for curl; unit level only).

## P11h: mid-stream retry, issue comments, e2e suite (2026-11-22)
- Owner's video (phone recording of the previous AI's chat) checked: it matches P0-P11f; it ended while writing `tests/e2e.mjs`, which was never pushed. That is now done.
- Mid-stream failure (krish/engine.ts): a stream only counts as complete with `[DONE]` or a `finish_reason`; provider `error` payloads and early EOF throw. Nothing shown yet -> one invisible retry. Partial text -> kept, with a notice. Partial tool call -> error, tool NOT run (never executes a tool from an unfinished stream). Reasoning-only output counts as shown.
- Issue comments: table `issue_comments`; `addComment/listComments` are scoped by user id (the bot tool `comment_issue` passes ctx.userId); `/api/issues/:id/comments`; Settings -> Issues -> Notes (auto-refreshes every 3s while open). Assignee/creator are woken; bot-to-bot ping-pong stops waking after 6 bot notes in a row (a user note resets it).
- `npm run test:e2e` (tests/e2e.mjs): real built server on a throwaway HOME and DB, scripted fake model, 15 checks: auto-login + foreign Host, chat, approval allow, danger deny (audit `declined`, marker file not created), mid-stream drop retry, truncated tool stream never runs, tool runs exactly once when the next step drops, budget blocks without a model call, workflow fork/join, cron validation, issues + comments, endpoints, Telegram token refusal.
- Totals: 56 unit tests + 15 e2e pass. A code review found 3 high issues (cross-user comments via bot tool, unfinished stream treated as success, comment ping-pong) - all fixed with tests.
- Still needs the owner's machine: real phone, WhatsApp scan, real Telegram token, Windows/Mac launcher, browser voice, real connector with a key, cron firing on a real clock.
- Still not built: goals tree, money cost tracking, offline Whisper, Slack/Discord, OpenManus per-step PlanningFlow executor, skills marketplace, handoff cards.

## P12a: robustness pass (2026-11-22, continues the video's last review)
- Video (phone recording, 25s) re-checked: it ends in a review listing: approval decision not validated, mobile Back button, Tasks view has no Back on phones, view switch without error boundary, voice cancel on abort, transcript scroll jump. None of those were in the repo.
- Done: `POST /approvals/:id` accepts only allow/always/deny (400 otherwise; before, a malformed value counted as allow); messages/answers/bot bodies validated (400, text cap 60000 -> 413); mobile.css: `.chat__back` default rule moved BEFORE the media query (it overrode the phone rule, so Back never showed); Tasks view has a Back button on phones; opening Tasks on phones switches to the chat pane.
- Test: e2e "bad input" (16/16 e2e, 56 unit, typecheck, build pass). Needs `NODE_OPTIONS=--max-old-space-size=400` and swap on a 482 MB VM.
- Next: P12b error boundary + transcript scroll + voice abort.
