# OpenKrishBot to-do (v1.9.0)

Rule: finish one part fully, ask you, update HANDOFF.md, then go on. Earlier parts get fixed again if I find a problem. Nothing is left over at the end.

- [x] **P21 Startup and logo**
  - No white screen at launch (dark loading page, dark window background)
  - New professional logo: two-eyed bot, in the app, installer, taskbar and tray
- [x] **P22 Models, account login (copy OpenMausBot's section)**
  - Replace the whole Models section with OpenMausBot's code
  - "Sign in with your account" opens the provider's own sign-in in the browser, with no terminal
  - Gemini / Codex CLI warnings (256-color, YOLO) are not errors
  - Live model list per provider, plus a small round refresh button
  - API-key provider section as in OpenMausBot
- [x] **P23 Connectors (copy OpenMausBot's)**
  - Replace the Connect Apps screen: real icons, readable text, the same connector catalog and flow
- [x] **P24 Computer and Settings black screen**
  - Find why the Computer view and its Settings are empty and black, and fix it
  - Add the missing option (the one you said was absent)
- [x] **P24b Computer view** (add to P24)
  - Computer view is always black: show the live screen, plus a history of what the bot did (copy OpenMausBot's)
- [x] **P29 Bot menus (copy OpenMausBot's)**
  - Bot right-click / "..." menu: New thread, New thread in a working folder, New folder, Delete all threads, Pin, Make Chief of Staff, Move to department, Mark as unread, Mark all as read, Edit Profile, Duplicate, Pause bot, Pause every bot, Copy conversation ID, Archive, Delete
  - "+" menu: New chat, New bot (Ctrl N), New group chat, Add department, Templates, Import
  - Pencil icon next to the Chief of Staff name to rename it
- [ ] **Reference repos for P26/P29:** elie222/rakazo, paperclipai/paperclip, nickvasilescu/orgo-teammates, nickvasilescu/bot-hq, CopilotKit/OpenBot, FoundationAgents/OpenManus, nickvasilescu/openman, CopilotKit/openfuse, HarnessMD/munder-difflin, Anil-matcha/superagent
- [x] **P25 Chat box and language**
  - Placeholder: "Hi, I am OpenKrishBot" (not "Hey Krish")
  - Hinglish stays Hinglish: reply in the language you write in
  - Settings > Language: app language switch, many languages
- [x] **P26 Bot icons**
  - Change the icon of any bot (upload / pick), using what the HQBot and Ektimate repos have
- [x] **P27 Earlier open items**
  - Check GrokBot's latest updates (local use only, no cloud) and port what's missing
  - Memory option in Settings (bots remember past chats)
  - Start a new project or continue an old one, as in GrokBot
- [x] **P28 Final**
  - Re-check P21-P27 together, fix leftovers, CI green on Windows/Mac/Linux, release v1.9.0, send you the release link
