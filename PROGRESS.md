# Cortex → usable app · progress log

Single source of truth for the "take the canvas prototype to a usable app" effort.
Read this first when resuming. Updated by the orchestrator after every phase / agent run.

- **Branch:** `app` (forked from `prototype-experimental` @ `b383ccb`, which stays untouched as the fallback)
- **Recover:** `git log --oneline app` — every phase ends in a commit named `Phase N…`. To roll back a phase: `git reset --hard <commit before it>`.

## Decisions (agreed 2026-11-13)

| Topic | Decision | Why |
|---|---|---|
| Host | **Electron** via `electron-vite` (main / preload / renderer) | real CLI calls, native dir pickers with real paths, native notifications, `shell.openExternal`, `<webview>` to embed GitHub / Jira / running apps (bypasses X-Frame-Options) |
| Agents | **Claude Code CLI** `claude -p --output-format stream-json --input-format stream-json --verbose` (spawned from main) | Agent SDK products are expected to use API keys / need approval for subscription login → user said "use the CLI then". Reuse the stream-json mapper from the `prototype` branch |
| GitHub / CI | real `gh` CLI (PRs, checks, runs, comments, merge). Builds = `gh pr checks` / `gh run`; no Jenkins CLI ("open in Jenkins" = open the check's details URL) | user requirement |
| Git | real `git` (worktree add/remove/list, status, diff, log, rebase) | user requirement |
| Jira | **mock CLI** `scripts/jira-mock` mimicking `acli jira workitem …`, output = Jira REST v3 issue JSON, backed by a JSON file | user requirement; swap for real `acli` later |
| State | **zustand** (keeps selector-hook API) + **zod** schemas; workspace persisted to a JSON file via main process (versioned, migrations) | persist to file |
| Remote data | **TanStack Query** for gh / git / jira / process polling | caching, refetch intervals, invalidation after actions |
| Viewers | react-markdown + remark-gfm (+ mermaid, from `prototype` branch), diff2html, CodeMirror 6 | records, diffs, todo / record editors |
| Quality | vitest + oxlint | |
| Domain model | discriminated union `Item` per kind with typed `data`; **kind registry** `src/renderer/kinds/<kind>/` owns icon, ring derivation, facts, actions, sidebar | today's `Item` is display-only (status/facts/subtitle strings) — can't drive real integrations |

### Reuse from other branches
- `prototype`: `src/services/types.ts` (gh / Jira / Claude DTOs), `services/mappers/*` (claude stream-json reducer, github, jira, ci), `components/session/*` (Transcript, QuestionCard, StatusLine, Composer), `components/Md.tsx` + `Mermaid.tsx`, `state/notify.ts`.
- `origin/claude/toolbox-projects-roadmap-diagrams-coj2na`: `views/PreviewView.tsx` (+ `views/preview/styles`) for the app/instance sidebar.

## Kinds (target)

| Kind | Icon | Actions (besides complete / archive) | Sidebar |
|---|---|---|---|
| project | project | create ticket (AI), review renovate PRs (AI), new worktree (UI), open repo, archive | name, repo, worktree dir, base repo dir, tickets, open PR summary, start cmd, test cmd, deployment links |
| ticket | (new icon) | change status (UI), open in Jira, create worktree, brainstorm (AI), plan (AI) | Jira details |
| worktree | code | rebase (AI), create PR (UI, stacked option → canvas link), launch app (UI), run tests, remove (UI), review (AI) | diff viewer, git stats |
| record (`records/<ticket-branch>/*.md`) | doc | plan→grill, brainstorm→plan, grill→implement, verification→none | markdown viewer |
| pr | pr | trigger AI review (comment), address review (AI), merge (merge/squash/rebase), rebase (auto if clean else AI) | GitHub PR view (webview) |
| agent | agent | stop, one action per pending AskUserQuestion option | harness UI |
| app | app | stop, restart, open external | embedded preview |
| build | build | rerun, open in Jenkins | details |
| deployment | link + stage chip (dev/prod…) | open, edit (UI) | status (mocked) |
| todo | todo | edit (UI), complete | text editor |
| testrun | test | rerun | details |

"AI" = insert a skill into the chat box (skills need not exist yet). "UI" = dialog / direct action.

## Current state (2026-11-14)

**All phases done on `app` @ `f7b5f69`.** 255 tests, typecheck/lint/build green. Real-repo click-through (`src/main/smokeRepo.ts`) passes 14/14 in dev and built app:
`GH_HOST=smoke.invalid CORTEX_SMOKE=1 CORTEX_SMOKE_REPO=1 CORTEX_SMOKE_OUT=<tmp> CORTEX_CLAUDE_BIN=<abs>/src/main/services/__fixtures__/fake-claude.mjs CORTEX_USER_DATA=<tmp>/profile npm run dev`

Docs: `README.md` (setup, first run), `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`.

### Open items / next steps
1. **First real runs (need the user):** `gh pr create / merge / comment / update-branch / edit --base` never ran against real GitHub; AskUserQuestion + permission prompts only verified against the fake Claude CLI → try one real Claude session and one throwaway PR.
2. Packaging (electron-builder; ship `scripts/jira-mock` unpacked).
3. Demo seed: refresher keeps calling gh for fake `ctx-observability/*` repos (backs off, logs errors); project sidebar refetches `gh pr list` often while gh fails → consider a "demo" flag that disables refresh for seed items, or start with an empty workspace.
4. `acli` output shape unverified (when switching off the jira mock).
5. Diffs omit untracked files; composer lacks skill autocomplete / model picker; chat dock narrow when sidebar is wide; "Change status…" icon is a caret.
6. Dev-mode CSP with HMR not exercised.

## Phases

| # | Scope | Owner | Status |
|---|---|---|---|
| 0a | Electron shell, typed IPC bridge (exec / pickers / notifications / openExternal / workspace file), persistence, audio + desktop notifications, vitest + oxlint | opus agent | ✅ done (`990aabd`) |
| 0b | Domain model refactor → typed per-kind data + kind registry, zustand + zod, TanStack Query wiring, seed migrated, new kinds stubbed | opus agent | ✅ done (`0f88e31`) |
| 1 | Integrations in main: gh, git, jira-mock CLI, process manager (apps / tests), claude CLI sessions | opus agent, isolated worktree → branch `phase-1-integrations` (merge into `app` after 0b) | ✅ done, merged (`9e9f860`) |
| 2a | Shared viewers in `components/viewers/`: Markdown (+mermaid), DiffViewer, CodeEditor, WebPanel (webview), LogView | sonnet agent, worktree → branch `phase-2a-viewers` | ✅ done, merged (`1908b3e`) |
| 2b | Renderer glue: data hooks, live sync + refresher, chat → real claude sessions, AskUserQuestion answering, form dialog / runTask / SidebarTabs / openExternal toolkit, project settings with pickers | opus agent on `app` | ✅ done (`e10c3b8`) |
| 3 | Kind modules (actions + sidebars), 4 parallel slices: A project+ticket+deployment · B worktree+record+todo · C pr+build+testrun · D agent+app | A,B sonnet · C,D opus, each in own worktree → branches `phase-3{a,b,c,d}-…` | ✅ done, all merged |
| 4 | Integration pass: gap fixes (list in log), cleanup, skills list, real-repo click-through smoke, docs | opus agent on `app` | ✅ done (`f7b5f69`) |

## Log

- 2026-11-14 — Phase 4 done (`1633284`…`f7b5f69`): skills list (17), prototype dialogs removed, stuck spinner toasts fixed, chat dock respects sidebar, SidebarSection actions slot, single Jira URL resolver (+ integration config now actually loaded), `gh:prEdit` + stacked-PR retarget + `mergeStateStatus` in ring, background build refresh, Settings dialog (HUD gear), production CSP, real-repo click-through smoke + fixes (Windows worktree removal while agent running, error texts, toasts position, agent handles, record discovery log spam), docs rewritten (`CONTRIBUTING.md` replaces the phase 3 brief). Orchestrator reviewed screenshots.
- 2026-11-14 — Phase 3d done + merged (`5b17fbb`; 241 tests total, all green). agent: harness sidebar (transcript w/ markdown, tool rows, thinking, question card, permission cards, composer w/ Esc interrupt, status line), option/allow/deny/stop/interrupt/follow-up actions. app: Preview webview w/ viewport switcher, Log, Details; start/stop/restart/open; ring by state. E2E verified with fake Claude CLI + a real `node -e` HTTP server (URL detection, restart frees port/pid, crash state). Hotspot: `debug.ts` (+inspect/select/runAction), smoke steps. Gaps: runTask spinner toasts can get stuck when many toasts are queued; floating action list/chat box overlaps sidebar bottom-left ~25px; composer has no skill autocomplete/model picker; real-Claude thinking/multi-question untested.
- 2026-11-14 — Phase 3c done + merged (`31d7b98`; 223 tests). pr: merge form (merge/squash/rebase, warnings, offer worktree removal), rebase via update-branch (conflicts → `/rebase` skill), AI review comment w/ confirm, address-review/review-pr/describe-pr (AI); sidebar Overview/Files/GitHub webview; stacked-PR section; build auto-discovery from checks. build: rerun (Actions, failed-only) or open details for Jenkins; jobs/steps sidebar + webview. testrun: rerun/stop, failing-test extraction, live log. Live-verified read-only on cli/cli#15052 (PR + Actions run) and a fake vitest run. No hotspots. Gaps: no `gh pr edit --base` retarget channel; ring ignores `mergeStateStatus` (not in schema); builds only refresh while a sidebar is open.
- 2026-11-14 — Phase 3b done + merged (`479971d`; 188 tests). worktree: Create PR form (push + stacked-on select → pr item + "stacked on" link), launch app / run tests (create app/testrun items), remove w/ force, rebase/review (AI), open folder/editor; sidebar Changes (diff vs base / uncommitted) + Stats. record: live markdown sidebar w/ edit + task toggles writing to file; grill/plan/implement (AI); **auto-discovery** of `<baseDir>/records/**/*.md`. todo: inline editor + preview, quick add. Hotspots: new `git:push` channel, `gitOps.push`, `startRecordDiscovery()` in `sync/index.ts`. Gaps: flows not clicked through in the app; diffs omit untracked files; PR body Jira link hard-coded `jira.ctx.internal`; skills grill/plan/implement not in ChatBox SKILLS list (phase 4).
- 2026-11-14 — Phase 3a done + merged (`2f2ea9b`; 173 tests). project: create-ticket/review-renovate (AI), new worktree form (ticket prefill), open repo/folder/editor, settings; sidebar with repo/paths/commands, tickets, PR summary, disk-vs-canvas worktrees, deployments. ticket: new icon, change status form (mock workflow), open in Jira, create worktree, plan/brainstorm, mark done w/ workflow walk; sidebar Details (ADF→md, comments) + Jira webview. deployment: stage chips (prod red), edit form, mocked status + preview. No hotspot changes. Dropped old "Plan a feature"/"Triage tickets"/"Implement"/"Refine" actions (match kinds table — ask user if wanted back). Gaps: form submits not click-tested e2e; `SidebarSection` lacks an actions slot (local Section used).
- 2026-11-14 — Phase 2b done (`79ff6ed`…`e10c3b8`, interrupted once by a rate limit and resumed). Workspace **v2** (settings prefs, agent localId/pendingPermissions/error). E2E smoke with the fake Claude CLI: chat → agent bubble → question → answer → done ✔; real git stats + gh counts on this repo ✔. Toolkit for kinds documented in `docs/ARCHITECTURE.md` → "Toolkit for kind modules" (`openForm`, `runTask`, `SidebarTabs`, `external/openPathAction/openInEditorAction`, `data/*` hooks + `*Ops`, `useOp`). Merged 2a → 158 tests, all green. Gaps: real AskUserQuestion protocol still only verified vs fake CLI; no main-branch CI status channel; no UI for model/permission mode; prototype dialogs in `overlays/Dialogs.tsx` still used (to be replaced in phase 3).
- 2026-11-13 — Phase 2a done on `phase-2a-viewers` (`7c14133`). Deps: react-markdown, remark-gfm, highlight.js (core + 9 langs), mermaid (lazy), diff2html (parser only, React rendering), CodeMirror 6 direct, anser. Lazy chunks: Markdown ~716 kB, CodeEditor ~969 kB, Diff ~74 kB. Not runtime-checked (webview, CM theme, mermaid). API in `components/viewers/README.md`. Deferred: ANSI light theme, diff syntax highlight / word diff, YAML/TS editor modes.
- 2026-11-13 — Phase 0b done (`c4da56a`…`0f88e31`, 51 tests): typed items (`domain/schemas.ts`), kind registry (`kinds/<kind>/`), zustand store, workspace v1 + v0→v1 migration (verified on a real v0 file), TanStack Query scaffold. Merged phase 1 (`9e9f860`, doc conflict resolved by hand) → 118 tests pass, typecheck/lint/build green. Hot spots for parallel agents: `domain/schemas.ts`, `kinds/{types,registry,common,icons}`, `store.ts`, `sidebar/index.tsx`, `data/queryKeys.ts`, `seed.ts`, `index.css`, `overlays/Dialogs.tsx`, `chat/ChatBox.tsx`. Started 2a + 2b in parallel.
- 2026-11-13 — Phase 1 done on `phase-1-integrations` (`e8f0025`, worktree `.claude/worktrees/agent-a4c50088887dfc080`). 89 tests. No new deps. Notes:
  - Channels: `git:*`, `gh:*`, `jira:*`, `claude:*`, `apps:*`, `tests:*` (+ events `claude:state/event`, `app:state/output`, `test:state/output`); renderer via `native.<service>.*` and `native.on(channel, cb)`. Details in `docs/ARCHITECTURE.md` → Integrations.
  - AskUserQuestion: claude started with `--permission-prompt-tool stdio`; the `can_use_tool` control_request is held and answered with `control_response {behavior:'allow', updatedInput:{…, answers}}`. Derived from CLI 2.1.323 schemas, **not yet verified against a real session** — first thing to test live.
  - Live-verified: git on this repo, gh prList/prView/prChecks/prDiff on sweedee/cortex (read-only), jira-mock via exec, test runner. gh write ops only unit-tested.
  - Jira: `CORTEX_JIRA_CLI=acli` switches to real acli (output shape unverified). Config knobs are env vars (see docs).
  - Gaps: no `git push` channel yet (pr create assumes pushed branch); jira-mock must ship unpacked when packaging; after `npm ci` in a fresh worktree run `node node_modules/electron/install.js`.
- 2026-11-13 — Started 0b (renderer refactor, on `app`) and Phase 1 (main-process integrations, separate worktree branch `phase-1-integrations`) in parallel. Phase 1 only adds to shared/ipc, preload, native.ts → merge expected to be easy.
- 2026-11-13 — Phase 0a done (3 commits up to `990aabd`). typecheck/lint/build pass, 22 tests. Bridge verified from a running app (dev + built). Notes for later phases:
  - Layout: `src/main`, `src/preload` (sandboxed CJS, only `electron` + `shared/ipc.ts`), `src/shared/{ipc,schemas}.ts`, renderer in `src/renderer/src`; `public/` stays at repo root; use `asset('brand/…')` for asset URLs.
  - All native access via `src/renderer/src/native.ts` (browser fallback). Adding a channel: see `docs/ARCHITECTURE.md`.
  - `exec:run` allowlist: git, gh, claude, node, jira-mock (jira-mock must be on PATH or resolution changed in Phase 1).
  - Deferred: production CSP, notification icon, electron-builder packaging, proc output throttling, fs path sandboxing.
  - npm 11.3.0 crashes on vitest peers → use `npx npm@11.21.2 install` when adding deps.
- 2026-11-13 — Reviewed repo + branches, agreed decisions above, created branch `app`, started phase 0a.
