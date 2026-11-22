# OpenKrishBot to-do (v1.9.0)

Rule: finish one part fully, ask you, update HANDOFF.md, then go on. Earlier parts get fixed again if I find a problem. Nothing is left over at the end.

- [ ] **P21 Startup and logo**
  - No white screen at launch (dark loading page, dark window background)
  - New professional logo: two-eyed bot, in the app, installer, taskbar and tray
- [ ] **P22 Models, account login (copy OpenMausBot's section)**
  - Replace the whole Models section with OpenMausBot's code
  - "Sign in with your account" opens the provider's own sign-in in the browser, with no terminal
  - Gemini / Codex CLI warnings (256-color, YOLO) are not errors
  - Live model list per provider, plus a small round refresh button
  - API-key provider section as in OpenMausBot
- [ ] **P23 Connectors (copy OpenMausBot's)**
  - Replace the Connect Apps screen: real icons, readable text, the same connector catalog and flow
- [ ] **P24 Computer and Settings black screen**
  - Find why the Computer view and its Settings are empty and black, and fix it
  - Add the missing option (the one you said was absent)
- [ ] **P25 Chat box and language**
  - Placeholder: "Hi, I am OpenKrishBot" (not "Hey Krish")
  - Hinglish stays Hinglish: reply in the language you write in
  - Settings > Language: app language switch, many languages
- [ ] **P26 Bot icons**
  - Change the icon of any bot (upload / pick), using what the HQBot and Ektimate repos have
- [ ] **P27 Earlier open items**
  - Check GrokBot's latest updates (local use only, no cloud) and port what's missing
  - Memory option in Settings (bots remember past chats)
  - Start a new project or continue an old one, as in GrokBot
- [ ] **P28 Final**
  - Re-check P21-P27 together, fix leftovers, CI green on Windows/Mac/Linux, release v1.9.0, send you the release link
