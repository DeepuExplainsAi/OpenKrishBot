# OpenKrishBot to-do (v1.9.1): copy, do not rewrite

Rule: copy files straight from the source repo, only adjust imports/names to fit. After every part: typecheck, update HANDOFF.md, commit, push.
Sources: milind-soni/OpenMausBot (Apache-2.0) and n8n-io/nod (Apache-2.0), cloned in ~/OpenMausBot and ~/nod.

- [x] **Q1 Models + API keys**: Maus model catalog (190+ providers incl. OpenCode Zen), key check, Test button
- [x] **Q2 Hosted MCP apps**: Maus native OAuth, browser sign-in in Connect Apps
- [x] **Q3 Hindi and all languages (web UI)** (Maus packs + DOM translator were in; added extra-hi.json for this app's own 91 strings): copy Maus `i18n.ts` + locale packs (hi, de, es, fr, ...), `t()` in every screen, Settings > Language switches the whole app
- [x] **Q4 MCP screen**: copy Maus McpServersPanel/McpServerEditor flow: add/edit server, Test, tools list, per-server on/off, import, secrets; server routes /api/mcp/servers from Maus mcp-registry/mcp-probe
- [x] **Q5 nod memory**: memory-tree, memory-recall, memory-learning, memory-lint, learned-skills (copied from nod)
- [x] **Q6 nod schedules, ledger, vault, keep-out, proactivity, local-files, feedback-redaction** (vault, feedback-redaction, learned-skills, skills done; ledger/proactivity/local-files/keep-out NOT copied: Postgres+Fastify rewrite, see HANDOFF part 7)
- [x] **Q7 Missing bits from first list**: bot delete/keep options (Maus bot menu), Computer view history, Chief of Staff pencil: re-check each against Maus (checked vs Maus: Chief pencil and Activity log were already there; added department menu with keep-bots delete)
- [ ] **Q8 Release v1.9.1**: CI green Windows/Mac/Linux, send the link
