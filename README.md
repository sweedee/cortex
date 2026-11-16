# cortex

A developer cockpit on one canvas. Projects, Jira tickets, git worktrees, plan records, Claude Code
sessions, pull requests, CI builds, running apps, test runs, deployments and todos are bubbles; the
links between them are the work in flight. Each bubble's ring shows its live state (git, GitHub, Jira,
your processes), its actions do the real thing (create the worktree, push and open the PR, run the
tests, merge), and one chat box at the bottom starts and steers Claude Code agents with the bubbles you
@mention as context.

It is a local web app: a Node server (`src/server`) runs on your machine and drives the real tools
(`git`, `gh`, the `claude` CLI and the Atlassian CLI `acli` for Jira, or a local mock for development), and
the React UI (Dynatrace Strato) runs in your browser. It was migrated from an Electron desktop app.

## Requirements

- **Node** 22.12+ (or 24) and npm
- **git** on `PATH`
- **GitHub CLI** `gh` on `PATH`, logged in (`gh auth status`): PRs, checks, Actions runs, merges
- **Claude Code CLI** `claude` on `PATH`, logged in: agent sessions (each session is one
  `claude -p --input-format stream-json …` process)
- **Atlassian CLI** `acli` on `PATH`, logged in (`acli jira auth login`): Jira work items. Without it Jira is
  shown as "not configured" in a production run (development runs fall back to the bundled mock, see [Jira](#jira-acli-or-the-mock))
- A modern desktop browser (Chromium, Firefox or Safari) for the UI

## Install, run, build

```
npm install          # if it fails with "reading 'edgesOut'": npx npm@11.21.2 install
npm run dev          # the server (restarts on changes) + the Vite renderer (hot reload)
npm run build        # typecheck, then bundle the renderer to out/renderer and the server to out/server/index.js
npm start            # run the built app: node out/server/index.js
npm run typecheck    # tsc for the server / shared code and the renderer
npm run lint         # oxlint
npm run format:check # prettier --check (npm run format writes)
npm test             # vitest
```

`npm run dev` prints the Cortex URL (`http://127.0.0.1:4317/?token=…`): open that one, not the Vite address.
It signs the browser in on the server and then redirects to the Vite dev server on `127.0.0.1:5173`.
`npm start` prints the same kind of URL. The server listens on `127.0.0.1` only; the port is `PORT`
(default `4317`). To run a built app elsewhere, ship `out/` and `package.json`, run `npm install --omit=dev`
there and `npm start`.

Cortex keeps its files in `~/.cortex` (config, workspace, Claude session list, Jira mock data, logs);
`CORTEX_USER_DATA=<dir>` runs with a separate profile.

## Security

Cortex runs `git`, `gh`, `claude` and your own dev / test commands as you, so the server is built to be
reachable only by the browser you opened it in:

- **Localhost only.** The server binds `127.0.0.1`, never `0.0.0.0`. Do not put it behind a reverse proxy or
  a tunnel: there is no multi-user model.
- **Token.** Each start generates a random token and prints it in the URL. Opening the URL sets an HttpOnly,
  `SameSite=Strict` cookie that every request then carries; the API also accepts `Authorization: Bearer <token>`.
  The token is not written to the log file. Anyone holding the URL can run commands on your machine, so do not
  share it. Set `CORTEX_TOKEN` (16+ characters) to keep the same token across restarts; `npm run dev` does this.
- **Host and Origin checks.** Requests must name `127.0.0.1:PORT` or `localhost:PORT` in `Host` (no DNS
  rebinding) and carry no `Origin` or an allowed local one (no cross-site requests from other pages).
- **Unattended Claude modes.** `bypassPermissions` and `dontAsk` (agents that never ask before acting) are
  refused until the server is started with `CORTEX_ALLOW_UNATTENDED=bypassPermissions,dontAsk` (or `all`).
- **Content Security Policy.** The page allows only the app's own scripts; no remote code, no `eval`.

## First run

A new install starts with an **empty canvas** and a welcome panel with two buttons: **Add a project** (opens
the add-project form, see step 1) and an optional **Load demo world**, a small made-up world (project
`unknown/demo`, three tickets, two PRs, a todo) that never touches your disk or the network. Without a
checkout the canvas starts empty with a welcome todo. To work on your own repo:

1. Right-click the canvas → *Add to canvas* → **Add project…**. Pick the repo's main clone as **Base checkout** with the
   folder browser: the GitHub repo (`owner/name` from `origin`), the default branch, a worktrees folder next
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
`~/.cortex/config.json` (see [Configuration](#configuration)). Notifications use the browser's Notification
API, so the browser asks for permission once. Right-click the canvas → *Reset workspace to
demo data* to start over (an empty canvas, as on the first run; the settings stay).

The workspace (bubbles, links, bubble colour, filter, sidebar width) is saved to `~/.cortex/workspace.json`
(previous version in `.bak`; versioned and migrated on load). The server saves the canvas, so reloading the tab keeps it.

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

Environment variables: `PORT` (default `4317`), `CORTEX_TOKEN` (fixed token), `CORTEX_USER_DATA` (profile
folder) and `CORTEX_ALLOW_UNATTENDED` (see [Security](#security)). The `CORTEX_*` overrides used in development
and tests (`CORTEX_JIRA_CLI`, `CORTEX_JIRA_SITE`, `CORTEX_CLAUDE_BIN`, …) are layered on top of config.json; a
production run (`npm start`) ignores them.

## Jira: acli or the mock

Jira goes through the **Atlassian CLI** (`acli jira workitem view | search | transition | create | comment |
edit`, verified with acli 1.3.40). Log in once with `acli jira auth login`; Cortex reads the site for links from
`acli jira auth status`. *Change status…* offers the statuses used in the ticket's Jira project (acli cannot
list a workflow's transitions; the names are the site's, e.g. localized ones like *In Arbeit*), and Jira
decides which moves are allowed. Settings → Jira shows the CLI, the site and any problem.

Without a working `acli` (not installed, or not logged in) a **production** run never shows the mock's fake
data: Jira is marked *not configured*, a banner on the canvas says "Jira not configured: install acli and run
`acli jira auth login`, or set jira.cli in config.json", and Settings → Jira repeats it.

The **mock** (`scripts/jira-mock`) has the same commands, prints the same JSON and keeps its data in
`~/.cortex/jira-mock.json`, seeded with made-up CTX-48xx tickets and a To Do → In Progress → In Review → Done
workflow. It is used with `"jira": { "cli": "mock" }` in config.json (or `CORTEX_JIRA_CLI=mock`
in development), and in development runs when `acli` is not on `PATH`.
`jira.site` in config.json (`CORTEX_JIRA_SITE=<url>` in development) overrides the site.

## CI

Builds are GitHub Actions jobs (from `gh pr checks` / `gh run view`; re-run with `gh run rerun`). Other CI
systems that report to GitHub through the checks API (Jenkins, Buildkite, …) show up as builds too; for them
Cortex opens the details page (*Open in Jenkins* / *Open details*) instead of re-running.

Running apps (*Launch app*) on `localhost` show in an iframe in the sidebar. Other pages (GitHub, Jira, CI
details, deployments) open in a new browser tab, since they cannot be embedded.

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

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the server, the HTTP / WebSocket transport, the domain
model, the kinds and the integrations; [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) the rules for changing it.

- `src/server/` — the Node server: `index.ts` (entry: port, token, static files), `http/` (the HTTP + WebSocket
  API, Host / Origin / token checks, CSP), `ipc/` (channel handlers, zod-validated), `services/` (git, gh, Jira,
  Claude sessions, app / test runners), `lib/` (node helpers: path policy, processes, file watching, workspace
  file, user config)
- `src/shared/` — the channel contract (`ipc.ts`), request schemas (`schemas.ts`, `integrationSchemas.ts`),
  tool DTOs and pure mappers (`integrations/*`), both sides import it
- `src/renderer/` — the browser UI (`index.html`, `src/`)
  - `native.ts` — the only way to the server (`POST /api/invoke/<channel>`, one WebSocket for events), with
    the browser-side pieces (open URL, notifications, folder picker) and a fallback for unit tests
  - `domain/` — zod schemas of the items (typed `data` per kind), workspace migrations
  - `kinds/` — one folder per kind: icon, ring, actions, sidebar
  - `sidebar/`, `components/viewers/` — sidebar sections; markdown (+ mermaid), diff, editor, log, web viewers
  - `data/` — TanStack Query hooks and write ops per integration
  - `sync/` — live events from the server, startup reconciliation, background refresh
  - `ui/` — `openForm`, `runTask`, open-URL / folder helpers
  - `chat/`, `canvas/`, `overlays/` — chat box, canvas, HUD / sidebar shell / settings
  - `store.ts`, `persist.ts`, `layout.ts` — zustand store, workspace load / autosave, d3-force layout
- `scripts/dev.mjs` — `npm run dev` (server with `tsx watch` + Vite); `scripts/jira-mock/` — the Jira CLI mock
- `public/` — static assets (favicon, brand marks), served as they are
- `out/` — build output (`out/renderer`, `out/server`), not committed
