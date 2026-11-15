# cortex

A developer cockpit on one canvas. Projects, Jira tickets, git worktrees, plan records, Claude Code
sessions, pull requests, CI builds, running apps, test runs, deployments and todos are bubbles; the
links between them are the work in flight. Each bubble's ring shows its live state (git, GitHub, Jira,
your processes), its actions do the real thing (create the worktree, push and open the PR, run the
tests, merge), and one chat box at the bottom starts and steers Claude Code agents with the bubbles you
@mention as context.

It is an Electron desktop app (electron-vite, React 18, Dynatrace Strato UI) that drives the real tools:
`git`, `gh`, the `claude` CLI and the Atlassian CLI `acli` for Jira (a local mock for development).

## Requirements

- **Node** 22.12+ (or 24) and npm
- **git** on `PATH`
- **GitHub CLI** `gh` on `PATH`, logged in (`gh auth status`): PRs, checks, Actions runs, merges
- **Claude Code CLI** `claude` on `PATH`, logged in: agent sessions (each session is one
  `claude -p --input-format stream-json …` process)
- **Atlassian CLI** `acli` on `PATH`, logged in (`acli jira auth login`): Jira work items. Without it Jira is
  shown as "not configured" in an installed app (development runs fall back to the bundled mock, see [Jira](#jira-acli-or-the-mock))

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

Cortex keeps its files in `~/.cortex` (config, workspace, window state, Claude session list, Jira mock data);
`CORTEX_USER_DATA=<dir>` runs with a separate profile. Chromium's caches and the logins of the embedded GitHub /
Jira pages stay in Electron's own folder (Windows `%APPDATA%\cortex`), not in `~/.cortex`. On the first start
after the move, an existing `workspace.json` (and its siblings) is copied over from that old folder once.

## First run

A new install starts with an **empty canvas** and a welcome panel with two buttons: **Add a project** (opens
the add-project form, see step 1) and an optional **Load demo world**, a small made-up world (project
`unknown/demo`, three tickets, two PRs, a todo) that never touches your disk or the network. To work on your own repo:
Without that checkout the canvas starts empty with a welcome todo. To work on your own repo:

1. Right-click the canvas → *Add to canvas* → **Add project…**. Pick the repo's main clone as **Base checkout** with the
   folder picker: the GitHub repo (`owner/name` from `origin`), the default branch, a worktrees folder next
   to it and the `dev` / `test` npm scripts are filled in. Adjust and save.
2. Select the project: **New worktree…** creates a branch + `git worktree` (optionally for a ticket),
   **Create ticket** / **Review Renovate PRs** hand the work to Claude.
3. On a worktree: **Launch app**, **Run tests**, **Create PR…** (pushes, then `gh pr create`; stacked PRs
   supported), **Remove worktree…**. Plan / brainstorm / grill files in `<base checkout>/records/<branch>/`
   show up as record bubbles by themselves (the folder is config.json `records.dir`).
4. Type in the chat box, `@mention` a worktree (or ticket, PR, …) and send: an agent bubble appears and
   runs Claude Code in that worktree. Its questions and permission prompts become actions on the bubble
   and cards in its sidebar.

The **gear** (top right) opens the global settings: Claude model, effort and permission mode for new
sessions, the AI-review comment, the refresh interval, notifications and sound. They are saved in
`~/.cortex/config.json` (see [Configuration](#configuration)). Right-click the canvas → *Reset workspace to
demo data* to start over (an empty canvas, as on the first run; the settings stay).

The workspace (bubbles, links, bubble colour, filter, sidebar width) is saved to `~/.cortex/workspace.json`
(previous version in `.bak`; versioned and migrated on load).

## Configuration

`~/.cortex/config.json` holds the machine / user settings. The first start writes a starter file with only a
`$schema` reference to `config.schema.json` next to it (completion and descriptions in VS Code); add what you
need. Edits apply while Cortex runs (`claude.bin` and `jira.cli` after a restart). A bad value falls back to its
default (Settings → *Config file* lists them); a file that is not valid JSON is ignored until it is fixed.

```jsonc
{
  "$schema": "./config.schema.json",
  "editor":  { "command": "cursor", "args": ["{path}"] },                 // "Open in editor"; default VS Code's code
  "claude":  { "bin": "claude", "model": null, "effort": null, "permissionMode": "default", "contextWindow": 200000 },
  "github":  { "aiReviewComment": "@claude review", "aiReviewBot": "claude[bot]",
               "renovate": { "app": "renovate", "label": "renovate" } },
  "jira":    { "cli": "acli", "site": "", "fields": { "storyPoints": "customfield_10016", "sprint": "customfield_10020" } },
  "git":     { "branchTemplate": "{key}-{slug}", "defaultBranch": "main", "worktreesDir": "../wt/{repo}" },
  "records": { "dir": "records" },                                        // inside each base checkout
  "refresh": { "intervalSec": 60 },
  "ui":      { "notifications": false, "sound": true }
}
```

- **Jira custom fields differ per site**: find yours with `acli jira workitem view <KEY> --json --fields "*all"`.
- `git.branchTemplate`: `{key}` = the issue key, `{slug}` = the title slug, e.g. `feat/{key}-{slug}`.
  `git.worktreesDir`: the default worktrees folder of a new project, relative to its base checkout or absolute.
- `editor.*` and `claude.bin` name programs Cortex runs, so the app itself never writes them: they are set in the
  file only.

The `CORTEX_*` environment variables (`CORTEX_JIRA_CLI`, `CORTEX_JIRA_SITE`, `CORTEX_CLAUDE_BIN`, …) are
development / test overrides on top of config.json; an installed app ignores them (except `CORTEX_USER_DATA`).

## Jira: acli or the mock

Jira goes through the **Atlassian CLI** (`acli jira workitem view | search | transition | create | comment |
edit`, verified with acli 1.3.40). Log in once with `acli jira auth login`; Cortex reads the site for links from
`acli jira auth status`. *Change status…* offers the statuses used in the ticket's Jira project (acli cannot
list a workflow's transitions; the names are the site's, e.g. localized ones like *In Arbeit*), and Jira
decides which moves are allowed. Settings → Jira shows the CLI, the site and any problem.

Without a working `acli` (not installed, or not logged in) an **installed** build never shows the mock's fake
data: Jira is marked *not configured*, a banner on the canvas says "Jira not configured: install acli and run
`acli jira auth login`, or set jira.cli in config.json", and Settings → Jira repeats it.

The **mock** (`scripts/jira-mock`) has the same commands, prints the same JSON and keeps its data in
`~/.cortex/jira-mock.json`, seeded with made-up CTX-48xx tickets and a To Do → In Progress → In Review → Done
workflow. It is used with `"jira": { "cli": "mock" }` in config.json (or `CORTEX_JIRA_CLI=mock`
in development), in development runs when `acli` is not on `PATH`, and in smoke runs (they never touch a real Jira unless started with `CORTEX_JIRA_CLI=acli`).
`jira.site` in config.json (`CORTEX_JIRA_SITE=<url>` in development) overrides the site.

## CI

Builds are GitHub Actions jobs (from `gh pr checks` / `gh run view`; re-run with `gh run rerun`). Other CI
systems that report to GitHub through the checks API (Jenkins, Buildkite, …) show up as builds too; for them
Cortex opens the details page (*Open in Jenkins* / *Open details*) instead of re-running.

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
