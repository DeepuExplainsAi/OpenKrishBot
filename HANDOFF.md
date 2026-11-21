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

## Parts
- [ ] P0 baseline imported (bot-hq as-is)
- [ ] P1 Rebrand to Krishbot AI + remove Orgo/Composio/xAI/Hermes cloud coupling, hide the licenses/credits from About
- [ ] P2 Local engine: Ollama + OpenAI-compatible (LM Studio, llama.cpp) + free providers; model picker with many models; no key needed to start
- [ ] P3 Local computer/screen per bot (replace Orgo): local browser (Playwright/CDP) + shell, watch / take control
- [ ] P4 MCP connectors: add/remove MCP servers (stdio + HTTP), provider catalog, per-tool approvals
- [ ] P5 Phone remote control of the laptop (LAN/PWA + QR pairing, optional free tunnel); laptop does the work
- [ ] P6 OpenMausBot features: rooms/groups, handoff cards, skills, routines UI, bot memory
- [ ] P7 OpenManus features: planning flow, browser/python/file tools, multi-agent flow
- [ ] P8 OpenBot features: AG-UI style approvals/interactive results, extra tools
- [ ] P9 Voice (local STT/TTS), polish, packaging (desktop launcher), final audit

## Status
Part 0 in progress.
