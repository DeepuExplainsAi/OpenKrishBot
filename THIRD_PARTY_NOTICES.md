# Third-party notices

OpenKrishbot is licensed under the GNU AGPL-3.0 (see `LICENSE`). It started from Bot HQ by Nick Vasilescu, which is MIT-licensed; that notice is kept below as the MIT licence requires. It bundles or depends on the third-party work listed below. npm dependencies not listed here are covered by their own licenses, included in their packages.

## Lucide icons

The web UI's icons come from [Lucide](https://lucide.dev), via the `lucide-react` package (pinned to 1.61.0 in `web/package.json`). They are rendered in `web/src/components/Icon.tsx`, `web/src/components/config/glyphs.tsx` and `web/src/components/VoiceCallBar.tsx`.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Some Lucide icons are derived from [Feather](https://feathericons.com). Those are under the MIT License:

```
Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Designs adapted from other open-source agents

OpenKrishbot's engine reimplements (in TypeScript, not copied line by line) ideas from these projects. Their licences require this notice.

- **OpenManus** (MIT, Copyright (c) 2025 manna_and_poem): the plan tool with step statuses, the stuck-loop check, and the step-by-step workflow idea (`server/src/plan.ts`, `server/src/flow.ts`).
- **Paperclip** (MIT, Copyright (c) 2025 Paperclip AI): bot-to-bot issues with checkout and wake caps, daily token budgets, the provider circuit breaker (`server/src/issues.ts`, `server/src/usage.ts`, `server/src/krish/breaker.ts`, `server/src/krish/resilient.ts`).
- **OpenMausBot** (Apache-2.0): the skill file format and trigger matching (`server/src/skill-library.ts`). Nothing from its `enterprise/` folder is used.
- **OpenBot** (MIT, Copyright (c) 2026 CopilotKit): chat UI patterns.
- **Rakazo** (Apache-2.0): the idea of a bot that manages other bots, with approval before changes (`update_bot` in `server/src/agent/tools.ts`).
- **Playwright MCP** (Apache-2.0, Copyright (c) Microsoft Corporation): the browser tool set (tabs, hover, select, upload, wait) in `server/src/screen/tools.ts`.

**nightly-labs/openbot** (PolyForm Noncommercial 1.0.0) is NOT used: none of its code, text or assets are in this project. Two product ideas were read from its public README and re-implemented independently: automatic summarising of long chats (`server/src/krish/compact.ts`) and a token-protected local scripts API (`server/src/scripts-api.ts`).

Libraries used by the free page reader (`server/src/krish/scrape.ts`): **@mozilla/readability** (Apache-2.0, Mozilla), **linkedom** (ISC, Andrea Giammarchi), **turndown** (MIT, Dom Christie).

MIT permission notice, applying to the MIT projects above: Permission is hereby granted, free of charge, to any person obtaining a copy of the software and associated documentation files, to deal in the software without restriction, including the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, subject to the above copyright notices being included in all copies or substantial portions. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## Hermes Agent

The bots run on [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research, which is MIT-licensed. Hermes is installed and run as a separate program; no Hermes code is copied into this repository.

## App logos

The Connect Apps screen and app cards show each app's logo by loading it at runtime from Composio's logo service (`https://logos.composio.dev/api/<toolkit>`). No third-party logos are bundled in this repository. When a logo can't load, the UI shows a letter tile instead. Each logo is a trademark of its owner, and showing one implies no endorsement.

The "Sign in with Google" button shows Google's "G" mark, which is a trademark of Google LLC.

## Original artwork

The bot characters (`server/src/avatar-shapes.ts`, drawn by `web/src/avatar/BotAvatar.tsx` and on each bot's home screen), the favicon, `assets/icon.svg`, the README banner and the screenshots were made for this project. The characters are built from basic geometry and covered by the project's MIT license.


## Bot HQ (base of this project)

```
MIT License

Copyright (c) 2026 Nick Vasilescu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
