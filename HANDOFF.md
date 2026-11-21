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
- [ ] P3 Local computer/screen per bot (replace Orgo): local browser (Playwright/CDP) + shell, watch / take control
- [ ] P4 MCP connectors: add/remove MCP servers (stdio + HTTP), provider catalog, per-tool approvals
- [ ] P5 Phone remote control of the laptop (LAN/PWA + QR pairing, optional free tunnel); laptop does the work
- [ ] P6 OpenMausBot features: rooms/groups, handoff cards, skills, routines UI, bot memory
- [ ] P7 OpenManus features: planning flow, browser/python/file tools, multi-agent flow
- [ ] P8 OpenBot features: AG-UI style approvals/interactive results, extra tools
- [ ] P9 Voice (local STT/TTS), polish, packaging (desktop launcher), final audit

## Status
P0, P1, P2 done. Server boots with zero keys (verified). Next: P3 local computer/screen (UI currently shows 'Couldn't wake computer: ORGO_COMPUTER_ID not set'). Remaining 'bothq'/'Bot HQ' internal identifiers (cookie, localStorage, db name) intentionally kept for now; rename in P9 with migration.

## P2 notes (for next agent)
- server/src/engine.ts is now a slim replacement (old Hermes engine deleted). Every bot -> in-process engine at /krish/v1/responses (server/src/krish/engine.ts), guarded by engineKey().
- krish/providers.ts: presets (Pollinations keyless default, Ollama, LM Studio, llama.cpp, OpenRouter, Groq, Cerebras, Gemini, Mistral, Together, DeepSeek, OpenAI, custom). Keys saved to ~/.krishbot/providers.json. REST: GET/PUT /api/krish/providers.
- krish/tools.ts: terminal, execute_code, read_file, write_file, patch, search_files, web_search (DuckDuckGo), web_extract, memory. Write/exec tools go through approval cards (policy key local:<tool>).
- krish/mcp-client.ts is a STUB -> implement in P4.
- App tools still come from agent/tools.ts via mcp.ts listTools/callTool (exported).
- Still TODO from Hermes era: routes-config.ts engine/login + screen routes (dead), Composio calls (401 warnings in log), 'Add to Slack' suggestion, x_search/xAI, voice.ts (xAI) -> P4/P9.
- Typecheck needs NODE_OPTIONS=--max-old-space-size=1400 (swap enabled). Web build: npx vite build in web/.
