# Architecture

One Node process (`server/`, Hono + SQLite) serves the React app (`web/`) and runs every bot. Nothing leaves the computer except calls to the model provider you pick.

```text
browser / phone ── HTTP + SSE ──► server ── /krish/v1/responses (in-process) ──► model provider (OpenAI-compatible)
                                     │
                                     ├── local tools: shell, python, files, web, plan, per-bot Chrome (CDP)
                                     └── connected apps: MCP servers started locally (npx / uvx / URL)
```

| Piece | Where | What it does |
|---|---|---|
| API + realtime | `server/src/routes*.ts`, `lib/hub.ts` | JSON over HTTP and one SSE stream per user (rows, live state, roster) |
| Turns | `agent/loop.ts` | Per-bot serial queue; streams the engine's events into rows and live state; approval cards |
| Engine | `krish/engine.ts` | The agent loop: model call, tool calls, history. Applies approval policy, `danger.ts` guard, redaction, audit log |
| Model calls | `krish/resilient.ts`, `breaker.ts`, `providers.ts` | Classify failures, retry with backoff, fall back to another ready provider, skip failing providers for 60 s |
| Local tools | `krish/tools.ts`, `plan.ts` | terminal, execute_code, read/write/patch file, search, web search/extract, memory, plan |
| Screen | `screen/*` | Per-bot headless Chrome via CDP, live JPEG stream over WebSocket, watch or take control |
| Apps | `apps.ts`, `routes.ts` (`/apps/registry`) | Curated catalog, custom MCP/web API, MCP registry search; tools named `<app>__<tool>`; non-read-only ask first |
| Routines | `routines.ts`, `triggers.ts`, `proactive.ts` | Cron routines, webhook routines (`/hooks/<secret>`), check-ins |
| Phone | `phone.ts` | QR pairing, LAN or free cloudflared tunnel, device list/revoke |
| WhatsApp | `whatsapp.ts`, `whatsapp-relay.ts` | Baileys link by QR; messages go to the main bot, approvals answered by replying 1/2/3 |
| Voice | `web/src/voice/*` | Browser speech recognition and synthesis; server only lists languages |
| UI | `web/src` | React + zustand: roster, chat, details panel, settings, viewer, voice bar |

## Security model
- Auto sign-in only for Host `localhost` from a loopback peer. Tunnel and LAN traffic needs a paired phone cookie.
- Writes and commands need approval; `danger.ts` patterns ask every time even after "Always allow".
- Tool output is redacted for common key formats; every tool run is appended to `~/.openkrishbot/audit.log`.
