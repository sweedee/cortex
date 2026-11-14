# cortex

A developer cockpit on one canvas. Projects, Jira tickets, git worktrees, plan records, Claude Code
sessions, pull requests, CI builds, running apps, test runs, deployments and todos are bubbles; the
links between them are the work in flight. Each bubble's ring shows its live state (git, GitHub, Jira,
your processes), its actions do the real thing (create the worktree, push and open the PR, run the
tests, merge), and one chat box at the bottom starts and steers Claude Code agents with the bubbles you
@mention as context.

It is an Electron desktop app (electron-vite, React 18, Dynatrace Strato UI) that drives the real tools:
`git`, `gh`, the `claude` CLI and a Jira CLI (a local mock by default).

## Requirements

- **Node** 22.12+ (or 24) and npm
- **git** on `PATH`
- **GitHub CLI** `gh` on `PATH`, logged in (`gh auth status`): PRs, checks, Actions runs, merges
- **Claude Code CLI** `claude` on `PATH`, logged in: agent sessions (each session is one
  `claude -p --input-format stream-json …` process)
- Optional: the **Atlassian CLI** `acli` for a real Jira (see [Jira](#jira-mock-or-acli))

## Install, run, build

```
npm install          # if it fails with "reading 'edgesOut'": npx npm@11.21.2 install
npm run dev          # the app with hot reload (main, preload and renderer)
npm run build        # typecheck + bundle to out/
npm run preview      # run the built app
npm run typecheck    # tsc for the node (main / preload) and web (renderer) projects
npm run lint         # oxlint
npm test             # vitest
npm run dev:web      # renderer only in a browser (native calls use the fallback in native.ts)
```

After `npm ci` in a fresh clone or worktree, run `node node_modules/electron/install.js` if Electron
complains that it failed to install.

`CORTEX_USER_DATA=<dir>` runs with a separate profile (workspace, window state, Jira mock data).

## First run

The canvas starts with a demo world (fake repos and paths; actions that need a real checkout are
disabled and say why). To work on a real repo:

1. Right-click the canvas → *Add to canvas* → **Add project…**. Pick the repo's main clone as **Base checkout** with the
   folder picker: the GitHub repo (`owner/name` from `origin`), the default branch, a worktrees folder next
   to it and the `dev` / `test` npm scripts are filled in. Adjust and save.
2. Select the project: **New worktree…** creates a branch + `git worktree` (optionally for a ticket),
   **Create ticket** / **Review Renovate PRs** hand the work to Claude.
3. On a worktree: **Launch app**, **Run tests**, **Create PR…** (pushes, then `gh pr create`; stacked PRs
   supported), **Remove worktree…**. Plan / brainstorm / grill files in `<base checkout>/records/<branch>/`
   show up as record bubbles by themselves.
4. Type in the chat box, `@mention` a worktree (or ticket, PR, …) and send: an agent bubble appears and
   runs Claude Code in that worktree. Its questions and permission prompts become actions on the bubble
   and cards in its sidebar.

The **gear** (top right) opens the global settings: Claude model and permission mode for new sessions,
the AI-review comment, the refresh interval, notifications, and where the workspace file lives. Right-click
the canvas → *Reset workspace to demo data* to start over.

The workspace (bubbles, links, preferences) is saved to `<userData>/workspace.json` (Windows:
`%APPDATA%\cortex\workspace.json`, previous version in `.bak`; versioned and migrated on load).

## Jira: mock or acli

By default Jira is `scripts/jira-mock`, a small CLI with the same commands as the Atlassian CLI
(`acli jira workitem search | view | transition | create | comment | edit`). It prints Jira Cloud REST v3
issue JSON and keeps its data in `<userData>/jira-mock.json`, seeded with the demo tickets (CTX-…), with a
To Do → In Progress → In Review → Done workflow that rejects invalid moves. Nothing leaves your machine.

To use a real Jira: install `acli`, run `acli jira auth login`, and start Cortex with
`CORTEX_JIRA_CLI=acli`. Check the custom field ids and status names in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#jira) first. Settings → Jira shows which one is active.

## Interactions

| | |
|---|---|
| Click / Shift-click | select / add to the selection; its actions appear next to the bubble and above the chat box |
| Double-click a bubble | open its details sidebar (drag the sidebar's left edge to resize; the expand button or a diff / web tab makes it wide) |
| Double-click empty canvas, F | fit everything (F: fit the selection) |
| Shift-drag on empty canvas | marquee select |
| Drag empty canvas / wheel | pan / zoom (around the cursor) |
| Drag a bubble | move it (moves the whole selection); it stays there until *Auto-arrange* |
| Enter | run the selection's primary action |
| Right-click canvas | add / import a bubble, fit, auto-arrange, reset to demo data |
| Right-click a bubble | all its actions (or the selection's) and related bubbles |
| `@` in the chat box | mention a bubble: it lights up, gets a thread to the chat box and becomes context for the agent |
| `/` in the chat box | insert a skill (`/plan`, `/implement`, `/review-pr`, …) |
| `#` or `!` in the chat box | run an action of the mentioned bubbles |
| Enter / Shift+Enter in the chat box | send (starts an agent, or continues the one agent mentioned) / new line |
| `/` or Ctrl+K, Esc, Del, Ctrl+A | focus the chat box, deselect / close, remove from the canvas, select all |
| Filter button (top right) | show only selected bubble types (none selected = everything), status, project, unread, archived |
| Bell (top right) | notifications; click one to fly to its bubble |
| Gear (top right) | settings (incl. bubble colouring: project, ticket, gray) |

Ring = status, derived from each bubble's data (segments for mixed states: an approved but conflicting PR
is part green, part orange; a breathing segment means something is running). Dot at the top right of a
bubble = notification. A chip under a bubble = its stage (deployments).

## Code map

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the processes, IPC channels, the domain model, the
kinds and the integrations; [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) the rules for changing it and the
smoke harness.

- `src/main/` — Electron main: window, IPC handlers (`ipc/*`), integrations (`services/*`: git, gh, Jira,
  Claude sessions, app / test runners), node helpers (`lib/*`), smoke harness (`smoke.ts`, `smokeRepo.ts`)
- `src/preload/` — exposes the typed bridge as `window.cortex`
- `src/shared/` — IPC contract (`ipc.ts`), request schemas, tool DTOs and pure mappers (`integrations/*`)
- `src/renderer/src/` — the UI
  - `native.ts` — the only way to native functionality (with a browser fallback)
  - `domain/` — zod schemas of the items (typed `data` per kind), workspace migrations
  - `kinds/` — one folder per kind: icon, ring, actions, sidebar
  - `sidebar/`, `components/viewers/` — sidebar sections; markdown (+ mermaid), diff, editor, log, web viewers
  - `data/` — TanStack Query hooks and write ops per integration
  - `sync/` — live events from main, startup reconciliation, background refresh
  - `ui/` — `openForm`, `runTask`, open-URL / folder helpers
  - `chat/`, `canvas/`, `overlays/` — chat box, canvas, HUD / sidebar shell / settings
  - `store.ts`, `persist.ts`, `layout.ts` — zustand store, workspace load / autosave, d3-force layout
- `scripts/jira-mock/` — the Jira CLI mock
