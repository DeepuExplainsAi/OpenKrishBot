---
name: openkrishbot
description: Install, start, update and troubleshoot OpenKrishbot, a local AI-bots app (Node.js server + web UI) at http://localhost:8787. Use when the user asks to install, run, fix or update OpenKrishbot.
---

# OpenKrishbot

Repo: https://github.com/DeepuExplainsAi/OpenKrishbot (AGPL-3.0, owner DeepuExplainsAi). Do not change the licence or author name.

## Requirements
- Node.js 22.13 or newer (`node -v`). Older versions fail (`node:sqlite` missing).
- No Python or compiler needed.

## Install and start
1. `git clone https://github.com/DeepuExplainsAi/OpenKrishbot`, then `cd OpenKrishbot`.
2. Windows: run `start.bat`. macOS/Linux: run `./start.sh`.
3. By hand, one command at a time: `npm install`, `npm run build`, `npm run serve`.
4. Open http://localhost:8787. Keep the server running.

## Windows PowerShell
- Plain `npm` fails with "running scripts is disabled": use `npm.cmd`, or run `start.bat`.
- PowerShell 5 does not support `&&`: one command per line.

## Update
`git pull`, delete `node_modules` if dependencies changed, then start again.

## Data and ports
- Data folder: `~/.krishbot` (SQLite file `krishbot.db`). Change the port with `PORT=8788`.
- Bots answer only with the Hermes agent and a model key or subscription (Engine panel).

## If something fails
Read the error, fix the cause, retry, and tell the user what you did.
