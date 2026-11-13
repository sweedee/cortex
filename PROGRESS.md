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

## Phases

| # | Scope | Owner | Status |
|---|---|---|---|
| 0a | Electron shell, typed IPC bridge (exec / pickers / notifications / openExternal / workspace file), persistence, audio + desktop notifications, vitest + oxlint | opus agent | ⏳ running |
| 0b | Domain model refactor → typed per-kind data + kind registry, zustand + zod, TanStack Query wiring, seed migrated, new kinds stubbed | — | todo |
| 1 | Integrations in main: gh, git, jira-mock CLI, process manager (apps / tests), claude CLI sessions | — | todo |
| 2 | Shared viewers: markdown (+mermaid), diff2html, CodeMirror editor, webview panel | — | todo |
| 3 | Kind modules (actions + sidebars), in parallel slices | — | todo |
| 4 | Integration pass, review, README/handoff | — | todo |

## Log

- 2026-11-13 — Reviewed repo + branches, agreed decisions above, created branch `app`, started phase 0a.
