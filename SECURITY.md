# Security

## Reporting a vulnerability
Report privately with GitHub's **Report a vulnerability** button on this repository's Security tab. Include what you found, how to reproduce it and what an attacker could do. Only `main` is supported.

## What you are running
Every bot is an AI agent with a shell, a browser and your connected apps on **your computer**, with your user's permissions. Anyone who can use the app, or put text in front of a bot (a web page it opens, an email it reads, a WhatsApp message), may be able to make it run commands. Keep approvals on for anything you would not do yourself.

## Built-in protection
- Writes, commands and non-read-only app actions ask first. Dangerous commands (recursive deletes, `curl | sh`, force-push, disk writes, key files) ask every time, even after "Always allow".
- Keys and tokens are hidden from tool output before the model or the chat sees them.
- Every tool run is recorded locally in `~/.openkrishbot/audit.log` (Settings → Activity log).
- The app signs you in automatically only for `localhost` from this computer. A phone must pair with a one-time QR code (5 minutes, single use) and can be revoked.
- WhatsApp: only your own number and numbers you allow can command the bot.

## Safe use
- Keep the phone tunnel off when not needed.
- API keys are stored in `~/.openkrishbot/providers.json` and the local database; do not share those files.
- Use a throwaway browser profile for logins you do not want the bot to reuse (`~/.openkrishbot/profiles`).
