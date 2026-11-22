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
- [x] P11 free page reader: `krish/scrape.ts` (Readability + Turndown, no keys, no browser) behind `web_extract`; test in server/test/scrape.test.mts
- [x] P12 fleet management (from Rakazo): `update_bot` tool (instructions, label, model, provider of another bot) always asks via approval card; `mcp_hq_*` tools now honour policyFor; test in server/test/fleet.test.mts
- [x] P13 ready-made companies: `server/templates/*.company.json` (Dropship Co, Growth Agency, Dev Studio, Research Desk); `GET /api/projects/templates`, `POST /api/projects/templates/:id` hires the team via importCompany; Settings -> Companies "Hire team". Goals, issues, budgets (Paperclip) were already ported in earlier parts. NOTE: full typecheck needs NODE_OPTIONS=--max-old-space-size=2048 and one workspace at a time on small machines

- [x] P14 browser tools (from Playwright-MCP): `browser_read` (page as Markdown), `browser_tabs`, `browser_hover`, `browser_select`, `browser_upload` (asks), `browser_wait`. Test server/test/browser-tools.test.mts runs against real Chrome in CI (opt-in locally: OPENKRISHBOT_BROWSER_TEST=1); the cloud sandbox Chrome never answers Page.enable, so it was verified in CI (Windows + Linux pass), not there. macOS CI runner: headless Chrome never answers Page.navigate, so the test is skipped there; check browser tools by hand on a Mac.
- [x] P15 no stray terminals (owner rule): the app never opens a terminal/console window by itself. All child processes use `windowsHide`; the old `terminal.ts` (opened Terminal/cmd for model sign-in) is deleted, sign-in now shows the command to run; `OpenKrishBot.bat` starts hidden through `scripts/hidden.vbs` (log: ~/.openkrishbot/launcher.log). Do not add anything that opens a terminal.
- [x] P16 notices for new libraries, version 1.2.0 (release workflow builds Windows, Mac, Linux on tag v*)

- [x] P17 ideas from nightly-labs/openbot (PolyForm NONCOMMERCIAL: never copy its code; ideas only, written from scratch): (a) long-chat auto-summary `krish/compact.ts` (history over ~20k tokens: old part summarised by the bot's model; window always starts at a user message; env OPENKRISHBOT_COMPACT_TOKENS); (b) Local scripts API `scripts-api.ts`: off by default, per-bot token (hashed), loopback + localhost Host only, `POST /script/messages {text, wait}`, `GET /script/status`; toggle in the bot's Engine panel. Verified over HTTP on a real server. Other ideas not done yet: FIFO message queue with pause/cancel, theme palette files, Docker image, remote server mode.
- [x] release v1.3.0 includes P17 (CI green on Windows, Mac, Linux before tagging)

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

## P12b: web robustness (2026-11-22)
- Checked P12a again before starting: server validation, mobile Back CSS and Tasks Back are all in place; nothing in P0-P11 changed.
- `ErrorBoundary` around the chat/Tasks pane (resets on view or bot change, "Try again" button): one crashing view no longer blanks the app.
- Transcript: auto-scroll pin is released only when the USER scrolls up (before, content growing under the viewport could unpin it).
- Voice `speak()`: abort listener removed after each utterance (no listener pile-up), already-aborted signal returns at once.
- Tests: typecheck, build, 56 unit, 16 e2e pass. UI behaviour (scroll, boundary) is NOT browser-tested here: no usable Chrome on the 482 MB VM.

## P12c: motion and polish (2026-11-22)
- Video part 1 (smooth animations): bubble entrance (`rise`), fade when switching bots (`view-fade`, keyed by bot id), loading skeletons in the transcript until rows load, button press feedback, offline banner ("Connection lost. Reconnecting…") shown only after a first successful connect (`sseEverConnected`). Existing menu/modal/toast/steps animations kept. `prefers-reduced-motion` already disables all of it.
- Source repos are cloned under /tmp (OpenMausBot Apache-2.0, OpenBot/OpenManus/Paperclip MIT). Rule from owner: take the best parts from them instead of writing from scratch; keep Krishbot's own look. Credit goes in THIRD_PARTY_NOTICES.md only (no licence text in the UI).
- Next P12d: goals tree (Paperclip `goals` table: level, status, parent, owner) in SQLite; P12e per-step PlanningFlow from OpenManus `app/flow/planning.py`; then Slack/Discord, handoff cards, money cost.

## P12d: compared our engine/tools/MCP with the reference repos (2026-11-22)
Owner asked: read the reference code and check OUR code will really work. Two sub-agents compared ours with OpenManus, OpenMausBot drivers and Paperclip. The third (chat apps/phone/launchers) timed out: STILL TO DO.
Fixed (all with tests, 61 unit + 19 e2e pass):
- Stream kept open after `finish_reason` made completed tool turns fail: now ends after a 1.5 s grace. Idle timer (120 s without bytes) replaces the 45 s cap that also cut long answers (45 s now covers connecting only).
- Parallel tool calls from relays that omit `index` were merged into one: now slotted by id.
- `finish_reason` length/content_filter with a tool call: refused, tool NOT run, clear message.
- Tool timeout reported as plain exit 1: now says "timed out after Ns"; missing program says so.
- `patch` on Windows CRLF files (model writes LF): matches on LF, keeps the file's CRLF. Empty old_text refused.
- `search_files` needed bash (absent on Windows): pure Node now (skips node_modules/.git, 100 hits).
- `write_file` says Created/Overwrote.
- Danger rule now also catches `rm -rf /*`, `~/`, `$HOME/`, `${HOME}`, quoted `"/"`.
- MCP: child env no longer inherits the server's provider keys (SDK default env + declared env only); a dead child is dropped from the cache so the next call restarts it; MCP `isError` results are now errors, not "done".
STILL OPEN from the comparison (not done yet, in priority order):
1. Issues: checkout never expires after a crash/restart/turn end (Paperclip adopts stale checkouts); status PATCH to in_progress can deadlock an issue; deleting a bot leaves stale assignee/holder; heartbeat has no attempt cap; cancel does not interrupt the holder.
2. Flows: runs stay `running` forever after a restart; failure wipes earlier step results; no per-step timeout; retries immediate and unclassified; croner `protect` does not stop overlapping runs (handler returns at once); step output can pick up other replies of the same bot; missed cron runs not caught up; no timezone per flow.
3. Engine: a broken MCP app slows every turn (serial, up to 60 s); Ollama models without tool support abort the turn (should retry without tools); mid-stream error payloads not retried; Ollama `num_ctx` not set; reasoning not replayed; plans cannot be listed/updated/deleted and a new plan abandons the old one; skill with empty trigger matches everything.
4. Budget: UTC reset, krish engine only (check `managed` path).

## P12e: issues and workflows hardened (2026-11-22), items 1 and 2 of the P12d open list
Issues (`issues.ts`, `routes-issues.ts`): heartbeat now releases an in_progress issue whose holder is idle for 10 min (crash/restart/turn ended) and re-wakes the assignee; todo nudges capped at 3 wakes total (`wakes` column, guarded ALTER that only ignores "duplicate column"); user setting in_progress by hand becomes todo (no deadlock); user cannot mark a parent done over open sub-issues or assign a bot that does not exist (409); cancel/reassign interrupts the bot that held it (`initIssueControl`); deleting a bot frees its issues.
Flows (`flow.ts`, `routes-flows.ts`): per-step timeout (20 min), retry backoff (2 s doubling), steps stopped on Stop (bot interrupted), step output = only the bot's reply to THIS prompt, failed run keeps earlier results, cron overlap guard via the run table (croner `protect` did not work), `reconcileRuns()` at boot marks interrupted runs failed.
Tests: 71 unit + 19 e2e pass, typecheck and build clean.
STILL OPEN: engine items (broken MCP app slows every turn, Ollama no-tools retry, mid-stream error retry, num_ctx), plan list/update/delete, skill with empty trigger, missed cron catch-up + per-flow timezone, budget on `managed` engine; chat apps / phone / launcher comparison (agent timed out, redo smaller); then goals tree, Slack/Discord, handoff cards, money cost; release page last.

## P12f: chat apps, phone, launcher analysis + fixes (2026-11-22)
Read: telegram.ts, whatsapp.ts, whatsapp-relay.ts, phone.ts, auth.ts, env.ts, launch.mjs, better-sqlite3 prebuilds.
Fine as is: WhatsApp reconnects with backoff and handles logout; phone pairing is loopback-only with 5 min one-time codes; owner auto-login only from loopback; better-sqlite3 13 ships win32/darwin/linux prebuilds (no compiler needed); data dir uses os.homedir().
Fixed: Telegram 429 (waits `retry_after`, 3 tries, no dropped reply), 409 (clear "another program is reading this bot" message), replies split at 3500 chars (was the WhatsApp limit, under Telegram's 4096), pairing code expires after 10 min; launcher: second double-click opens the running app, busy port gives a clear message with the PORT=… fix (health probe has a 2 s timeout, found by testing a port held by a silent process), non-zero server exit explains itself.
NOT tested: the Telegram changes (no unit test; verified by reading only), WhatsApp with a real phone, phone pairing on a real LAN, Windows/Mac launch.
Not changed on purpose: server listens on all interfaces when HOST is unset (needed for phone-on-Wi-Fi). Non-loopback requests need a paired-phone session, so this is OK, but a firewall prompt on Windows is expected on first start.

## P12g: engine items (2026-11-22)
Fixed: MCP apps connect in parallel with a 15 s deadline, a failed app is skipped for 60 s (a broken app no longer slows every turn); model that "does not support tools" (Ollama 400) is retried once without tools; blank skill trigger terms are dropped; a new `plan create` closes the old active plan instead of leaving it open; budget message says UTC midnight; prompt tokens of a stream that dropped mid-answer are now counted.
Checked, not bugs: loopNudge history is already per bot; budget applies to every bot (all bots use the same in-process engine, "managed" is only a label).
Tests: resilient (tools retry), skills (blank trigger). Plan replace and MCP parallel/skip have NO test (verified by typecheck/e2e only).
Still open: Ollama `num_ctx` (not set, default context may truncate long chats), reasoning not replayed, mid-stream error payload not retried with backoff, plan list/update/delete, room `@` substring match, ALTER catches at routes-flows.ts:18 and agent/rooms.ts:18.

## P12h: small items (2026-11-22)
Fixed: room `@name` matches whole names only (@Sam no longer wakes @Samantha); the two swallowed ALTER catches now ignore only "duplicate column"; flows catch up one missed cron slot (<24 h old) after the computer was off, tracked in kv `flowcron:<id>`; first boot of a schedule starts the clock instead of firing an old slot.
Tests: rooms.test.mts (mentions), flows-schedule (missedRun). Catch-up at boot is NOT tested end to end.
Not a bug: flow timezone. Cron uses the computer's own timezone, which is the user's on a local app.
Not fixable here: Ollama `num_ctx`. Its OpenAI-compatible endpoint ignores it; the user sets OLLAMA_CONTEXT_LENGTH for the Ollama server. Mention in release notes.

## P12i: plan close, retry pause, notices (2026-11-22)
Added: `plan close` command (a Bot can drop an unfinished plan); the invisible stream retry now waits 1.5 s; THIRD_PARTY_NOTICES.md credits OpenManus, Paperclip, OpenMausBot (no enterprise code), OpenBot. Credits live only in that file, not in the UI.
`plan close` has no test.
Left as is on purpose: reasoning is not replayed to the model (providers differ; replay can break some); mid-stream error payloads get one invisible retry (only when nothing was shown yet).

## P12j: goals tree (2026-11-22)
Paperclip's goals, adapted to SQLite for one user. `server/src/goals.ts` (table, tree, rollup progress, cycle/ownership checks, delete lifts children), `routes-goals.ts` (/api/goals, PUT /api/goals/link), `issues.goal_id` (sub-issues inherit the parent's goal), Bot tool `list_my_goals` + `goal_id` on `create_issue`, UI: Settings → Goals (tree, owner, status, progress bar) and a goal chooser on Issues.
Tests: goals.test.mts (4), e2e "goals" (HTTP, 20 total). Unit 79, e2e 20, typecheck/build clean.
NOT verified: the Goals screen in a real browser (no Chrome here; only typechecked).
Still not built: per-step PlanningFlow executor, Slack/Discord, handoff cards, money cost tracking, offline Whisper, skills marketplace.

## P12k: money cost (2026-11-22)
Optional per-bot price (USD per 1M tokens in/out, kv `price:<bot>`), `PUT /api/bots/:id/price`. No price = free model, cost 0. Cost is computed from the current price x recorded tokens (changing the price re-prices history; shown as "≈"). UI: price inputs + "Cost today" in the bot's Engine budget row; last-7-days usage and total in Settings → Activity log.
Tests: usage.test (price), e2e "price" (21 total). Unit 80. UI not seen in a browser.

## P12l: Plan with AI (2026-11-22)
Redone from scratch: the previous agent's version (OpenManus PlanningFlow idea) was never committed. `server/src/flow-plan.ts` (prompt + strict parser: JSON found inside prose, bot names matched, ids normalised, unknown needs dropped, validated by `validate`), `POST /api/flows/plan {goal, bot?}` (planner = given bot or the first bot; saves nothing), Workflows editor has a "Plan with AI" goal box that loads the draft steps into the editor.
Tests: flow-plan.test.mts (3), e2e "Plan with AI" (22 total). Unit 83, e2e 22, typecheck clean.
NOT verified: the UI in a real browser; planner quality with a real model (planner reply is parsed strictly, an unusable reply gives a clear error).
Planned next, from the OpenMan repo (nickvasilescu/openman, cloned to ~/openman, not committed): its skills, projects with shared instructions, generators (slides/docs/charts), meeting notes, websites, automations. Compare against Krishbot and port what is missing (P13).

## P13a: skills import (2026-11-22), first port from OpenMan (nickvasilescu/openman)
OpenMan review (read README, ARCHITECTURE, docs/skills.md, src/lib/skills|automations|generators): it is a Next.js + Supabase + Orgo-cloud product, so only ideas port, not code. What Krishbot lacked and OpenMan has: (1) add your own skills + GitHub import + 55-skill official library [this part], (2) automation "only if" conditions on triggers (conditions.ts, small), (3) RSS/HTTP-poll triggers, (4) projects with shared instructions + reference files, (5) generators (slides, docs, charts, audio), (6) meeting-file transcription to notes, (7) websites built and hosted locally, (8) task share/collaboration, (9) skill-from-a-task.
Done in P13a: `skill-library.ts` loads shipped skills plus `~/.krishbot/skills/<id>/` (user skills never shadow shipped ones). `POST /api/skill-library/import {url|markdown}` (github.com only, repo or folder link, SKILL.md front matter name/description/triggers; no triggers = answers to its own name), `DELETE /api/skill-library/:id` (user skills only). Skills page: "Add skill" box + Remove on custom skills.
Tests: skills.test (+2), e2e "skills import" (23 total). Unit 85, e2e 23, typecheck clean.
NOT verified: import against real GitHub (fetch is faked in the unit test), UI in a browser. Only SKILL.md is imported, not scripts shipped beside it. Still not built: the 55-skill official catalog (can now be imported by link), items 2-9 above.
Next: P13b = trigger "only if" conditions (2) and RSS trigger (3), then (4) projects.

## MERGE PLAN: old repo `DeepuExplainsAi/Krishbot` -> this repo (2026-11-22). WAIT for the owner's go before doing it.
Owner's intent: ONE project (Krishbot), updated step by step with the reference repos (OpenMan, OpenMausBot, Paperclip, OpenManus, OpenBot, Composio ideas). Two repos exist by accident of earlier agents. `krishbot-ai` (this one) is the more complete: ~178 files vs 118. Owner will test the v1.0.0 desktop release first, then say what to add. Never delete either repo; the old one only gets a README pointer at the end.
Old repo: branches `main` (28 commits, Hermes-era + direct model connections + NSIS installer) and `full-port` (15 commits, local-only port). Clone it to ~/krishbot-old to read.

### Take from old repo (not in this one), in this order
1. Subscription models, no API key needed: `server/src/providers.ts` presets of type `cli` (Claude via `claude -p`, ChatGPT via `codex exec`, Gemini CLI, OpenCode, Kilo, Kiro, Qwen, "any command, prompt on stdin") + `server/src/agent/direct.ts` (CLI runner and neutral message format) + `server/src/terminal.ts` (opens a terminal for sign-in; has Windows/macOS/Linux branches). Port INTO `server/src/krish/providers.ts` and `resilient.ts` (new type `cli` next to openai-compatible; fallback chain and breaker must treat it like any provider). Test with a fake CLI script on all 3 OS in CI.
2. Extra providers missing here: Anthropic API directly (own message format, `type: 'anthropic'`), xAI Grok, NVIDIA NIM, Hugging Face router, Moonshot (Kimi), Z.ai (GLM), GitHub Models, Perplexity, Fireworks. Add to the preset list; keep model ids as in the old file but re-check them.
3. Models settings page: `web/src/components/config/ModelsSection.tsx` (grouped list: Your subscription / On this computer, free / Free tiers / API keys; live model list with Refresh). Rebuild it on the new `/api/krish/providers` API.
4. `SKILL.md` at the repo root (guide for coding agents: install, start, update, Windows PowerShell notes). Update it for the new launcher and installers. Keep "do not change the licence or author name".
5. `web/src/styles/select.css`, `web/src/voice/audio.ts` and `server/src/settings.ts` (app_settings table: autoApprove etc.): diff against this repo first, take only what is missing.
6. Old NSIS/.deb details: already covered by `desktop/` (electron-builder). Only compare the icon script `build/icon.mjs` if a better icon is wanted.

### Do NOT take
Hermes engine, Orgo, Composio, xAI-only voice, `scripts/add-hq-to-hermes.py`, `bots.ts`/`box.ts` cloud parts, `start.bat`/`start.sh` (replaced by Krishbot.bat/krishbot.sh/launch.mjs and the desktop app). No cloud pieces at all: owner wants everything local.

### Licence
Both repos are AGPL-3.0 now (this one switched on 2026-11-22; the Bot HQ MIT notice stays in THIRD_PARTY_NOTICES.md). Code from the old repo is AGPL, so no licence conflict.

### After the merge
Update README (providers, subscription login), HANDOFF status, run unit + e2e, push a tag (v1.1.0) so the desktop workflow publishes new installers, then add a one-line README pointer in the old repo (no deletions).

## Desktop release (2026-11-22)
`desktop/` = Electron 39 shell (`main.cjs` starts the packaged server with ELECTRON_RUN_AS_NODE, opens a window; single instance; external links open in the browser). `scripts/desktop-prep.mjs` copies server+web builds in; `.github/workflows/release.yml` builds on Windows (NSIS setup + portable exe), macOS (dmg + zip, x64 and arm64), Linux (AppImage + deb) and smoke-tests the packaged server (`scripts/desktop-smoke.mjs`); a `v*` tag publishes a GitHub Release. `ci.yml` runs typecheck + unit + e2e on all 3 OS.
Lessons: Electron 33 crashed the server (SIGSEGV) with better-sqlite3 13, Electron 39 works (Node 22). Use `npm ci --ignore-scripts` (better-sqlite3 ships prebuilds; the Windows runner has no usable compiler for a rebuild). rpm dropped: rpmbuild failed. Installers are UNSIGNED (Windows SmartScreen, macOS Gatekeeper warnings) until certificates exist. The window UI was never opened by a human on Windows/macOS: only the packaged server was smoke-tested.
Open: Railway downloads page (static page that lists the GitHub Release files; the app itself stays local), rpm, auto-update, code signing, goals-tree UI check in a real browser, P13b (trigger conditions, RSS trigger), projects.

## P14 merge from old repo + rename (2026-11-22)
- Product name is now **OpenKrishBot** (was Krishbot; `~/.krishbot` -> `~/.openkrishbot` and `bothq.db` -> `openkrishbot.db` are migrated by server/src/migrate.ts) everywhere (launchers OpenKrishbot.bat/.command/openkrishbot.sh, desktop productName, appId ai.openkrishbot.app). Repo name unchanged.
- Desktop: server binds 127.0.0.1 only, window loads 127.0.0.1 (stops the Windows "allow public and private network" prompt).
- Subscription models (no key): `server/src/krish/cli.ts` runs claude / codex / gemini / grok / kimi / cursor-agent / vibe / opencode / qwen CLIs, prompt on stdin; the CLI is its own agent. Presets with `cli` in krish/providers.ts. Command flags for Grok/Kimi/Cursor/Vibe are NOT verified against real CLIs.
- Added API providers: Anthropic (via its OpenAI-compatible endpoint, not native format), xAI, Fireworks, NVIDIA, Hugging Face, Moonshot, Z.ai, GitHub Models, Perplexity.
- Composio: removed again on purpose (owner: only fully local). Local MCP catalog + registry search stay.
- SKILL.md ported from old repo.
- Still to do: Models settings page UI in the old style, OS-level screen control, Windows installer test on a real PC, screenshots of the UI (no Chrome on this VM).

## P13b: trigger conditions + RSS trigger (2026-11-22), OpenMan items 2 and 3
- `server/src/conditions.ts` ("only if", dot paths, 8 ops, all must hold), `server/src/feed.ts` (RSS/Atom parser + fetch), `triggers.ts`: webhook routines check conditions against the JSON body; `feed:<url>` routines poll every 15 min while the app is open (first poll only remembers existing items, max 5 per poll, seen ids kept in routines.seen).
- Bot tools: `create_event_routine` got `conditions`; new `create_feed_routine`. Routine descriptions show the trigger.
- Tests: triggers.test.mts (4). Unit 89.
- NOT verified: against a real feed / real webhook over HTTP; no UI to add conditions by hand (bots create them). Feed fetch does not block private addresses (local app, user's own feeds).
- Next: P13c projects (4), then generators (5), meeting notes (6), websites (7), share (8), skill-from-task (9).

## P13c: projects (2026-11-22), OpenMan item 4
- `server/src/projects.ts` + `routes-projects.ts` (/api/projects): name, shared instructions (max 20k chars), reference text files (max 20 files, 100k chars each, same name overwrites), bots.project_id. Bot prompt gets the instructions and files (files up to 6k chars inlined within 24k total; longer ones are named and opened with the new `read_project_file` tool).
- UI: Settings -> Projects (create, edit instructions, upload text files, assign each Bot to a project).
- Tests: projects.test (3), e2e "projects" (24 total). Unit 92, e2e 24.
- NOT verified: UI in a real browser (no Chrome on this VM). Text files only (no PDF/images). Agent-proposed project updates (OpenMan's approval-card flow) not built.
- Release fix: Linux smoke test used the old binary name after the rename (desktop job failed on v1.1.0 Linux only); fixed, tag v1.1.0 re-pushed.
- Next: P13d generators (5), meeting notes (6), websites (7), share (8), skill-from-task (9). Re-check P13b/c first.

## P13d: generators as skills (2026-11-22), OpenMan item 5
OpenMan's generators need its Orgo computer + Python helper, so only the idea ports: four shipped skills in server/skills/: `slide-deck` (one self-contained HTML deck, arrow keys, `n` = notes, print = PDF; template's JS was run against a DOM stub: navigation, clamping, progress and notes verified), `spreadsheet` (openpyxl, formulas, frozen header, CSV fallback), `chart` (matplotlib/SVG, one takeaway per chart), `voiceover` (free edge-tts MP3). Trigger words match requests like "make a slide deck about…".
NOT verified: a real bot run end to end with a real model; the deck in a real browser (no Chrome here); edge-tts/openpyxl/matplotlib are installed on demand by the bot (not bundled). No PPTX export, no image/video generators.
Tests: skills.test (+1). Unit 93.
Next: P13e meeting notes (6), websites (7), share (8), skill-from-task (9). Re-check P13b-d first.

## P13e: meeting notes (2026-11-22), OpenMan item 6
New `transcribe` tool (`server/src/transcribe.ts`): faster-whisper in `~/.krishbot/stt/venv`, installed on first use, ffmpeg decodes audio/video, saves `<file>.transcript.txt` with `[mm:ss]` stamps. Asks the user first (installs software). Skill `meeting-notes` turns it into summary / decisions / action items / timeline. Env: `KRISH_WHISPER_MODEL` (default base), `KRISH_STT_PYTHON` (override interpreter).
Tested: wrapper with a stub interpreter (3 tests). NOT tested with real Whisper: this VM has no python3-venv; needs ffmpeg + python3(-venv) on the user's computer (Windows: python on PATH). No speaker labels. Desktop version bumped to 1.1.1 (v1.1.0 release assets are named 1.0.1).
Next: websites (7), share (8), skill-from-task (9).

## P15: Models settings page (2026-11-22)
Old Krishbot had a Settings → Models page; the merged app had providers but no page. Added `web/.../ModelsSection.tsx` (groups: Your subscription / On this computer / Free tiers / API keys; key, address, Sign in, Test) and routes `POST /api/krish/providers/:id/test` and `/login` (opens the CLI's sign-in in a terminal via `server/src/terminal.ts`, copied from old Krishbot). `GET /providers` now returns group, cli, canLogin, hasKey, env.
Verified over real HTTP against a fake OpenAI-compatible server: bad key -> "bad key", good key -> reply, missing CLI -> clear 409. NOT verified: UI rendering (no browser here); real sign-in terminal on Windows/Mac; no live model-list "Refresh" button in this page (models are picked in the chat Engine panel).

## P16: installed app can start connected apps and CLIs (2026-11-22)
Cause found: an installed desktop app is launched with a short PATH, so `npx`/`uvx` (connected apps) and subscription CLIs (`claude`, `codex`...) were not found. New `server/src/lib/launch.ts` (`launchEnv`, `launchCommand`) adds the usual tool folders to PATH and uses `npx.cmd` on Windows; used by `apps.ts` and `krish/cli.ts`.
Verified: server started with `env -i PATH=/nonexistent` still connects the npx app; connect/custom http/bad command error/registry/remove all answered correctly over HTTP. Not verified on a real Windows install.

## P17: speed (2026-11-22)
Measured: `/api/krish/providers` and `/api/bots/:id/engine` took ~0.35-0.39 s each, because every call re-ran `which` for each CLI preset and re-fetched `/models` for every provider (cloud ones with no key too). Now `cliFound` is cached 30 s, `liveModels` 60 s, and a keyless-less cloud provider skips the network. Settings -> Models opens with `?fresh=1`, and Test clears the cache. Result: 0.057 s first call, 0.001 s after. Unit 99/99.
Not measured: UI render speed in a browser (no Chrome here); startup time of the packaged app on Windows.

## P13f: websites, share, skill-from-task (2026-11-22), OpenMan items 7-9 (all local, no cloud)
- (7) Websites: `server/src/sites.ts` serves any Library folder with an index.html at `/sites/<botId>/<folder>/` (owner only, sandboxed CSP, path-traversal blocked). Tool `publish_site`. Chat menu: "Open website". Only reachable on this computer / your tunnel; there is no public hosting.
- (8) Share: `server/src/share.js` + `GET /api/bots/:id/share` = the conversation as one offline read-only HTML file (no scripts). The header Share button used to say "not available"; it now downloads it. No live collaboration (OpenMan's needs its cloud).
- (9) Skill from task: tool `save_skill` writes a user skill (`~/.krishbot/skills`) through `installSkill`, so triggers/enable/remove in Settings -> Skills already work; built-in ids are refused.
Tested: sites.test (5), share.test (2); real HTTP: site 200, `..` and `%2e%2e` -> 404, no cookie 401, share 200 with CSP.
NOT tested: a real model calling save_skill/publish_site; browser rendering of the Share/Open website menu entries.

## P18: finishing pass (2026-11-22)
- Fixed CI on Windows (2 tests: path separator in sites.test, stub interpreter in transcribe.test skipped on win32). Unit 106 pass.
- New tool `browser_screenshot`: saves a JPEG to Library/screenshots and attaches it to the next model turn for vision-capable model ids (`SEES_IMAGES` in krish/engine.ts). Non-vision models just get the file name. NOT verified with a real model/Chrome (none on this VM).
- Desktop 1.1.2: real `.ico` for the Windows exe/installer/shortcuts (installed-apps list and Start menu show the icon), desktop + Start-menu shortcuts, server log in `~/.krishbot/desktop.log`, error dialog if the server does not start. SmartScreen note in README (unsigned installers).
- Launcher/SKILL.md names now say OpenKrishbot. `~/.krishbot` data folder name is kept on purpose (existing data).
- Still open: OS-level screen control (cua-driver licence not checked; browser only), code signing, real-PC Windows install test, UI check in a real browser.

## P19: bots hire bots, Grokbot legacy removed (2026-11-22)
- New tools `create_bot` (name, role, company, instructions) and `list_bots`: the Chief (or any bot) builds companies of specialist bots, each with its own browser/memory, then delegates with `send_to_bot`. Company + role go in the bot's label. Prompt (agent/prompt.ts) tells bots to do this for multi-site jobs. MAX_BOTS default 4 -> 12, delegation depth 3 -> 4. Test: create-bot.test.mts.
- Removed old Grokbot compat (grokbot cookie, GROKBOT_ env, grokbot.db, localStorage `grokbot.*`).
- Checked orgo-teammates / OpenMausBot / OpenBot: Chief-of-Staff + create_bot + team templates (OpenMausBot) are the relevant ones. Not ported: team import/export templates, @everyone routing, a "company" grouping UI, per-bot idle sleep.
- NOT verified: a real model hiring bots and running Amazon/Flipkart/Pinterest jobs; 12 Chrome profiles on a small RAM machine (each bot starts its own Chrome on first browser use).

## P20 (v1.1.3): companies, vault, export/import
- Company = project; bots carry `projectId`; sidebar groups bots under the company name. Chief's `create_bot` takes `company` + `company_goal`.
- `projects.ts`: `exportCompany` / `importCompany` (`openkrishbot-company-v1`, no chats/memory/keys; text scrubbed of vault values). Routes `GET /api/projects/:id/export`, `POST /api/projects/import`. UI: Settings → Companies.
- `vault.ts` (+`routes-vault.ts`, Settings → Vault): AES-256-GCM, key `~/.krishbot/vault.key`. Every item is bound to an https site. Tools: `list_secrets` (names), `secret_request` (GET/HEAD only, key sent only to the saved site, no redirects), `browser_fill_secret` (website login typed into a field on the saved site only). `scrubVault` runs on every Krish-engine tool result. `danger.ts` now asks approval for `vault.key`/`bothq.db` paths.
- Idea credit: Rakazo (Apache-2.0) bot-secrets design; no code copied.
- Known gaps (from review): Hermes/MCP path does not run `scrubVault`; screenshots can show a typed password; a bot with `terminal` can still read vault.key (same OS user); sidebar company names refresh only on roster change.

## P18 — Message queue with pause / cancel (v1.4.0)
- `server/src/agent/loop.ts`: per-bot FIFO (`push`/`pump`) replaces the promise chain. `pauseQueue`, `resumeQueue`, `cancelQueued(id?)`, `queueView`. Cancelled background jobs reject with "cancelled".
- Routes: `GET /api/bots/:id/queue`, `POST /api/bots/:id/queue/{pause|resume|cancel}` (cancel body `{id?}`); SSE event `queue`.
- UI: `QueueRow` in `EngineSettings.tsx` (shown only when something waits or paused).
- Test: `server/test/queue.test.mts`. Idea from the openbot README only; code written independently.
- Not done: theme palette files, Docker image, remote server mode.

## P19 — mem0 notes, web_crawl, Docker, pipelines (in progress on branch p18-queue, v1.4.0)
Done:
- `server/src/krish/memory.ts`: `memory` tool dedupes / updates / `replaces` / `forget` (mem0 idea, word overlap, no model call). Test `memory.test.mts`.
- `web_crawl` tool (`crawlSite` in `scrape.ts`, crawl4ai idea): same-host BFS, max 50 pages, path prefix. Test in `scrape.test.mts`.
- `run_pipeline` tool (`agent/pipeline.ts`, crewAI idea): up to 3 bots in order, last reports to starter. Test `pipeline.test.mts`.
- Docker: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/sign-in-link.sh` (one-time sign-in link via owner key). NOT yet built or tested (no Docker on the VM). Check CI/local build.

## TODO checklist (everything the user asked for; do in order, commit + push after each, update this file)
1. [x] (done) Merge p18-queue to main after CI green; tag v1.4.0 and publish release (wait for `desktop` workflow, 8 assets).
2. [~] (README done P27; CI job needs workflow scope) Docker: add a CI job that runs `docker build .` (needs `workflow` scope, which we lack: ask user to add it, or run build elsewhere). Document in README (run, sign-in link, reverse proxy + TLS, APP_URL).
3. [x] (done P27) Remote server mode: bind/URL docs, `APP_URL` public, sign-in via link; optional access token for `/script`.
4. [x] (done, P20) Theme palette files: JSON palettes in `web/src/styles/themes/*.json` (CSS variables from `tokens.css`), picker in Settings → General, saved in localStorage; keep light/dark/system.
5. [x] (done, P21: browser_extract + stuck warning; highlight skipped) browser-use ideas (MIT): `browser_extract` (structured fields from the page by a schema), a `browser_task` loop with step limit and "stuck" detection (same action/URL 3x -> stop and tell user), highlight of clickable elements in `browser_snapshot`.
6. [x] (done, P22; browser_save_screenshot skipped, screenshots already saved) Playwright-MCP leftovers: `browser_console` (read console messages), `browser_network` (list requests), `browser_pdf`/`browser_save_screenshot` to file, `browser_drag`, `browser_resize`, `browser_handle_dialog`.
7. [x] (done, P23: sitemap, robots.txt, 10-min cache; content filter = Readability, CSS extraction = browser_extract) crawl4ai leftovers: `sitemap.xml` discovery in `web_crawl`, robots.txt respect, content-fit filter (drop nav/footers), CSS-selector extraction, cache for repeated URLs.
8. [x] (done, P24: `recall` tool = keyword search over old chats; per-user memory scope not done) mem0 leftovers: semantic recall (local embeddings or keyword index over past chats) injected into the prompt; per-user vs per-bot memory scopes.
9. [x] (done, P25: goal+backstory fields, templates sop-software + startup-studio with CEO manager) crewAI / MetaGPT leftovers: role templates with goal + backstory, task context passing, hierarchical "manager" bot that plans and assigns, SOP-style company templates (Product Manager -> Architect -> Engineer -> QA).
10. [x] (P29 egress guard, P30 fence + webhook rate limit, P31 routine catch-up done. Skipped on purpose: quiet hours (check-in times are user-chosen), routine undo, spend caps, needs-you digest, webhook HMAC) Other repos from the user's first list not mined yet: suparagent (marketplace), openfuse (connectors), munder-difflin (rooms), orgo-teammates. Read each, list ideas, build the useful ones.
11. [x] (stagehand, langgraph, autogen reviewed: P32, P33, P35 built. Not built: approval with edited args, selector cache for browser_extract) Find more popular MIT/Apache repos (e.g. n8n-style workflow nodes, AutoGen, LangGraph ideas, Open Interpreter, Stagehand, Firecrawl OSS parts): ideas or code with notices in `THIRD_PARTY_NOTICES.md`. Never copy PolyForm/AGPL/noncommercial code.
12. [ ] (needs a real PC; cannot be done on this VM) Verify on real machines: Windows installer + hidden launcher, browser tools on macOS.
13. [x] v1.5.0 = P27-P33; v1.6.0 = P34-P35.

## P20 — Palette files
- `web/src/themes/*.json` (`{name, base, vars}`; Midnight, Forest, Sand, Rose) loaded by `web/src/lib/palettes.ts` (`import.meta.glob`); only `--color-*` vars apply. `configStore`: `palette`, `setPalette`; picker under Settings → General → Colours. A palette sets its own light/dark base. Add a palette = add a JSON file.

## P21–P22 — browser tools
- P21 `screen/extract.ts`: `browser_extract` (CSS selectors -> JSON rows; `sel@attr`, `@attr` = the row itself) and a stuck-page warning in `browser_snapshot` after 3 identical looks. Test `extract.test.mts`.
- P22 `screen/manager.ts` keeps console + network ring buffers and last dialog; new tools `browser_console`, `browser_network`, `browser_dialog`, `browser_resize`, `browser_drag`, `browser_pdf`. Covered by `browser-tools.test.mts` (runs in CI only; check its result there).

## P23 — polite crawling
- `scrape.ts`: `robotsDisallow`, `sitemapUrls`, `fetchPageCached` (10 min, 100 entries), `crawlPolitely` (used by `web_crawl`); `crawlSite` takes `disallow` and `seeds`. Tests in `scrape.test.mts`.

## P24–P25
- P24 `krish/recall.ts`: `recall` tool, keyword ranking (rare words weigh more) over the bot's last 5000 chat messages. Test `recall.test.mts`.
- P25 company templates accept per-bot `goal` + `backstory` (put before instructions in `projects.ts`); new templates `sop-software` (Manager -> PM -> Architect -> Engineer -> QA via run_pipeline) and `startup-studio` (CEO manager).

## P27 — remote server docs
- README "Run as a server (Docker)": compose, sign-in link, TLS proxy, `APP_URL`, `SCRIPT_REMOTE`.
- `SCRIPT_REMOTE=1` lets `/script` be called from other machines (`scripts-api.ts`); the bot token is still required. Not unit-tested (flag is read at import).
- Not done: Docker CI job (token lacks `workflow` scope), real Docker build.

## P28 — audit args scrubbed
- `krish/engine.ts` `runTool`: audit-log args now go through `scrubVault`, so a vault value typed into a tool call is not written to the audit file. (see P34 for transcript and cards).
- v1.4.0 released (8 assets, desktop workflow green).

## P29 — egress guard (from suparagent idea, written from scratch)
- Reason: `web_extract`/`web_crawl` followed redirects anywhere, so a page could point a bot at `http://127.0.0.1:8787/api/...` (loopback = auto-login as owner) or cloud metadata.
- `lib/egress.ts`: `isPrivateIp`, `assertPublicUrl` (http(s) only, DNS-resolved host must be public). `scrape.ts`: `fetchPage(url, {publicOnly})` re-checks every redirect hop (max 5); `fetchPageCached`, robots/sitemap fetches use it. Escape hatch `OPENKRISHBOT_ALLOW_PRIVATE_FETCH=1`. Test `egress.test.mts`.
- Not covered: DNS rebinding between check and connect (check resolves, fetch resolves again); `apps.ts` / `vault.ts` fetches (user-configured URLs, left as is); browser tools (can open localhost on purpose).
- Reference review of suparagent/openfuse/munder-difflin/orgo-teammates done (MIT/Apache); ideas list is in item 10.

## P30 — fence untrusted text, webhook rate limit (suparagent `fence.py` / openfuse rate-limit ideas, from scratch)
- `lib/fence.ts`: `fenceUntrusted` (webhook body and feed item go into the routine prompt as one JSON string under an "untrusted data" label) and `rateLimiter`. `triggers.ts`: 30 calls/min per webhook secret, else 429. Test `fence.test.mts`.
- Not done: HMAC/header auth for webhooks (secret in path only), login-attempt limiter (`login_attempts` table unused), scrubbing credential-looking values inside fenced text. A model can still be talked into things by data; the fence lowers the risk, it does not remove it.

## P31 — routine catch-up after downtime (suparagent idea, from scratch)
- `routines.ts` `missedSince`: at startup a cron routine whose latest due time in the last 24 h is after its last run (or creation) runs once. Test `routine-catchup.test.mts`.
- Not done: retry on failure (no failure signal on routine runs yet), per-routine catch-up window setting.

## P32 — group chat rotation (autogen selector-group-chat idea, from scratch)
- Bug: a message to the whole group always woke the first 3 members, so members 4+ never answered. `agent/rooms.ts` `pickResponders` now rotates (last asked id kept in `kv` `roomlast:<room>`); @mentions unchanged. Test in `rooms.test.mts`.
- From the stagehand/langgraph/autogen review, still open: flow resume after crash, approval with edited args, room termination conditions, human gate between flow steps, selector cache for `browser_extract`.

## P33 — continue a failed flow run (langgraph checkpoint idea, from scratch)
- `flow.ts` `RunOptions.resume`: steps that are `done` in an earlier run keep their output; the rest run again and see the old outputs via `{{id}}`. `POST /api/flows/runs/:runId/resume` (only failed/stopped runs, one run per flow at a time) -> new run. UI: "Continue (keeps finished steps)" next to a failed/stopped run (Settings -> Workflows). Test in `flow.test.mts`.
- Works after a crash too: the restart marks the run failed but keeps saved step results. A step that was mid-run when the crash hit runs again, so its side effects can happen twice.
- NOT checked in a browser (UI button only typechecked).

## P34 — send and switch model while a job runs; vault scrub in transcript
- Owner request: while a bot works, the user must still be able to send messages and change the provider/model, and the running job must finish first. Checked, not rebuilt: the server already queues (`enqueue` / per-bot FIFO from P18), and `PATCH /bots/:id/engine` works any time. The composer never blocked sending, but now says so in the placeholder ("is working. Type anyway: it goes next in line"). Each turn reads the bot's model when it starts, so a running job keeps its model and the queued message uses the new one.
- New e2e test (`tests/e2e.mjs`): slow job running -> switch model -> send 2 messages -> queue shows 2 waiting -> first job finishes on the old model, then both queued ones answer on the new model, in order.
- Vault: assistant text, tool-call args and approval cards (detail + args) now go through `scrubVault` before they are written to the transcript. e2e checks the transcript and audit. The user's own messages are left as typed.
- "Bolt" in OpenMausBot is only a test bot's name, not a system (checked by search), so nothing was ported for it.
- Still open: vault in the Hermes/MCP path; screenshots can show a typed password; a bot with `terminal` can read vault.key.
- Memory note: the VM has ~480 MB, so build/typecheck need `NODE_OPTIONS=--max-old-space-size=700` and not two at once.

## P35 — workflow "Ask me first", webhook signature, room post limit
- Workflow step option `gate` (checkbox "Ask me first" in Settings -> Workflows): before the step runs, an approval card (`flow_step`) shows in that bot's chat. No/expired = step fails with "Not approved.", downstream skips, and "Continue" (P33) can retry it. `askGate` in `routes-flows.ts`, `approve` option in `flow.ts`. Unit + e2e (waits, deny, continue, allow).
- Webhooks: an `X-Hub-Signature-256: sha256=<hmac of body, key = secret>` header is checked if sent (wrong = 401). No header = old behaviour (secret in address only). `checkSignature` in `lib/fence.ts`.
- Rooms: `postToRoom` allows one post per bot per user message (stops bot-to-bot floods). Test in `rooms.test.mts`.
- Test status at release: typecheck clean, 145 unit, 27/27 e2e (`npm run build` then `node tests/e2e.mjs`).
- Not built: approval with edited args, selector cache for `browser_extract`, room stop-phrases. Not verified: any UI in a real browser; Windows/Mac installs; Docker build.

## P36 — "Always autonomous" mode
- `danger_mode` now has 3 values: `ask` (risky asks every time), `follow` ("Always allow" respected everywhere), `auto` (nothing asks except risky calls).
- Risky = `dangerReason` rules (rm -rf of top folders, disks, downloaded scripts, force-push, keys) plus tool names that move money (`riskyReason` in `danger.ts`). Risky calls ask in `auto` as well.
- Applied in `krish/engine.ts` (local tools, HQ tools, connected apps) and `mcp.ts`. UI: Settings > Permissions, three choices.
- Tests: `danger-auto.test.mts`, e2e "autonomous mode".

## P37 — vault gaps, edited approvals, extract cache
- Vault: MCP/Hermes tool output is scrubbed (`mcp.ts`); the vault key itself is scrubbed from text; `browser_fill_secret` refuses a non-password field; any command touching `vault.key`/`.ssh` asks even in `follow`/`auto`.
- Approval card has Edit: `POST /approvals/:id {decision, edit}`; `applyEdits` changes only existing plain values of the same type.
- `browser_extract` takes `name`: selectors saved per bot+site in `kv` (only after a non-empty result); call with just the name later.

## P38 — in-app updates
- `desktop/main.cjs` uses `electron-updater` (checks 15 s after start, and Settings > General > Updates > "Check for updates" via `desktop/preload.cjs` `window.krishDesktop`).
- Windows Setup and Linux AppImage/deb update themselves in place and restart. Windows Portable and macOS (unsigned, so no silent update) download the matching file from the release and open it.
- Release workflow now uploads `latest*.yml` and `.blockmap` files; they are what the updater reads. `build.publish` points at the GitHub repo.
- Versions before 1.8.0 have no updater: install 1.8.0 by hand once.
- Not testable on the VM: the real update flow needs two installed versions on a real PC.
- [x] P19 one-line dismissible notices (no red box, short provider-switch text); desktop window opens at once with a loading page and shows a dialog with the log tail if the engine crashes; version 1.8.1
- [x] P20 desktop package lacked linkedom/turndown/readability (app stopped on start); added, smoke test now runs from a copy outside the repo; version 1.8.2
- [x] P21 new bot logo (assets/icon.svg, app/installer/web icons), dark by default and dark loading page (no white flash); version 1.9.0-dev
- [x] P22 Models: warnings (256-color/YOLO) stripped from CLI output, NO_COLOR; 'Sign in with your account' now starts the login itself (Claude/Codex in the browser, others open a sign-in window); model picker is a dropdown with a round refresh button (also on Settings > Models); CLI providers have model lists and the chosen model is passed to the CLI
- [x] P23 Connect Apps: brand logos for 30 apps (web/public/logos, Simple Icons CC0), readable descriptions and letter tiles in dark mode. Connectors stay local MCP (OpenMausBot's catalog needs its hosted broker, which the owner does not want)
- [x] P24 Computer: start page is a white 'Ready' page instead of about:blank, default page background forced white (headless captured it black); History button in the large view lists the bot's browser actions; Settings > Computer no longer talks about a cloud computer / sleep. NOT verified on a real screen (build VM cannot run Chrome): owner to confirm on Windows
