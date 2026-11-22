# OpenKrishbot

Your own team of AI agents, running on your own computer. Free, local, no account, no cloud server.

## Start

1. Install [Node.js 22+](https://nodejs.org) (and Chrome or Edge for the bot's browser and voice).
2. Double-click `OpenKrishbot.bat` (Windows) or `OpenKrishbot.command` (Mac), or run `./openkrishbot.sh` (Linux).
   First run installs and builds, then opens http://localhost:8787.

It works with no keys: the default model is free (Pollinations). Add Ollama or LM Studio for fully offline models, or paste a free-tier key (Groq, OpenRouter, Cerebras, Gemini, Mistral…) in the bot's Engine panel.

## What it does

| | |
|---|---|
| **Bots** | Chat, rooms, memory, routines, tasks, a plan checklist for multi-step work. |
| **Models** | Any OpenAI-compatible endpoint. Retries with backoff, falls back to another ready provider, and skips a provider that keeps failing. Plain-language errors. |
| **Computer** | Each bot has its own Chrome on this computer (watch live or take control), plus shell, Python and file tools. |
| **Apps** | 39 curated connectors plus a search of the public MCP registry (thousands of servers). Everything runs locally; keys stay in the local database. |
| **Safety** | Writes and commands ask first. Dangerous commands ask every time. Keys are hidden from transcripts. Local activity log in Settings. |
| **Phone** | Settings → Phone: scan a QR to control this computer from your phone (same Wi-Fi, or a free tunnel). Installable as an app. |
| **WhatsApp** | Settings → WhatsApp: link by QR and message your bot from WhatsApp. |
| **Voice** | Hands-free voice chat and dictation using the browser's free speech recognition and synthesis. |

Data lives in `data/` and `~/.krishbot`.

## Develop

```
npm install
npm run dev        # server + web with reload
npm run typecheck
npm test
```

See `HANDOFF.md` for design notes and what is not verified yet.

## Licence
GNU AGPL-3.0 (see `LICENSE`). Third-party notices: `THIRD_PARTY_NOTICES.md`.

## Windows install notes
The installers are unsigned, so Windows SmartScreen shows "Windows protected your PC": click **More info → Run anyway**. The app listens on 127.0.0.1 only, so there is no firewall prompt. If it does not open, read `%USERPROFILE%\.krishbot\desktop.log`.
