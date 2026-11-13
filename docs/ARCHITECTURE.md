# Architecture

Cortex is an Electron app built with electron-vite. Three processes, one window.

```
┌──────────── main (Node) ────────────┐   ipcMain.handle / webContents.send
│ src/main/index.ts   lifecycle        │◄──────────────────────────────────┐
│ src/main/window.ts  BrowserWindow    │                                   │
│ src/main/ipc/*      handlers (zod)   │                                   │
│ src/main/lib/*      node helpers     │                                   │
└──────────────────────────────────────┘                                   │
┌──── preload (sandboxed, CJS) ────┐  contextBridge: window.cortex          │
│ src/preload/index.ts             │────────────────────────────────────────┘
└──────────────────────────────────┘
┌──────────── renderer (Chromium, no Node) ─────────────┐
│ src/renderer/src/native.ts  ← the only door to native  │
│ everything else: React UI, store, layout               │
└────────────────────────────────────────────────────────┘
src/shared/ipc.ts      contract: channel names, request/response/event types, CortexApi
src/shared/schemas.ts  zod schema per invoke channel (used by main)
```

## Rules

1. **The renderer never touches Node or `window.cortex` directly.** All native access goes through
   `src/renderer/src/native.ts`, which also provides a browser fallback (`npm run dev:web`, unit tests):
   exec / proc / fs reject with a clear error, the workspace lives in localStorage, notifications use the
   Web Notification API.
2. **Every invoke channel is declared in `src/shared/ipc.ts` and validated in main** with its schema in
   `src/shared/schemas.ts` (a compile-time check keeps schemas and types in sync). Handlers are registered
   with `handle()` (`src/main/ipc/handle.ts`), which also rejects callers other than the app window.
3. **The preload only forwards.** It is sandboxed, so it may only import `electron` and the dependency-free
   `shared/ipc.ts` (types). Never expose `ipcRenderer` itself.
4. **No shell for programmatic commands.** `exec.run` spawns via `cross-spawn` (resolves Windows `.cmd`
   shims, escapes args) with `shell: false` and an allowlist. Only `proc.start` with `shell: true` uses a
   shell, for commands the user configured (e.g. a project's `npm run dev`).
5. **Logic that can live outside Electron does** (`src/main/lib/*`): it is unit-tested in node without
   an Electron runtime.

## Window

Dark background (`#07080f`), `contextIsolation`, `sandbox`, no `nodeIntegration`, `webviewTag: true`
(GitHub / Jira / running apps are embedded in later phases; attached webviews are stripped of preload /
node). Bounds are saved to `<userData>/window-state.json`. `window.open` / `target=_blank` and
navigations away from the app open in the OS browser (http/https only). Single-instance lock.

## IPC channels

| Channel | Request → response | Notes |
|---|---|---|
| `exec:run` | `{cmd, args, cwd, env?, timeoutMs?, stdin?}` → `{code, stdout, stderr, timedOut}` | `cmd` ∈ `git gh claude node jira-mock` (`jira-mock` → the configured Jira CLI, see Integrations); no shell; tree-killed on timeout (default 120 s) |
| `proc:start` | `{id, cmd, args, cwd, env?, shell?}` → `ProcInfo` | long-running; output via `proc:output`, end via `proc:exit` |
| `proc:stop` | `{id}` → `boolean` | kills the whole tree (Windows `taskkill /T /F`, POSIX process group) |
| `proc:list` | → `ProcInfo[]` | running processes; all are killed on app quit |
| `dialog:pickDirectory` | `{title?, defaultPath?}` → `string \| null` | |
| `dialog:pickFile` | `{title?, defaultPath?, filters?}` → `string \| null` | |
| `shell:openExternal` | `{url}` | http(s) only |
| `shell:openPath` | `{path}` → `{ok, error?}` | folder / file in the OS |
| `shell:openInEditor` | `{path}` → `{ok, error?}` | `code <path>`, falls back to `openPath` |
| `notify:desktop` | `{title, body, tag?, itemId?}` | Electron `Notification`; click focuses the window and sends `notify:clicked` |
| `workspace:load` | → `unknown \| null` | `<userData>/workspace.json`, falls back to `.bak` |
| `workspace:save` | `{data}` | atomic (tmp + rename), serialized (last write wins), previous version kept as `.bak` |
| `workspace:path` | → `string` | |
| `fs:readText` / `fs:writeText` | `{path}` / `{path, text}` | absolute paths; writes are atomic |
| `fs:list` | `{dir, options?: {glob?}}` → `FsEntry[]` | `*`, `?`, `**`, `{a,b}`; skips `node_modules` / `.git` when recursing |
| `fs:watch` / `fs:unwatch` | `{dir}` → `watchId` / `{watchId}` | recursive `fs.watch`, events via `fs:changed`; all watches close on reload |
| `app:info` | → `{platform, userData, version, electron}` | |

Events (main → renderer): `proc:output {id, stream, chunk}`, `proc:exit {id, code, signal, error?}`,
`notify:clicked {itemId?}`, `fs:changed {watchId, dir, event, path}`. Subscribe through `native.*.onX(cb)`,
which returns an unsubscribe function. `proc:output` is batched (one event per process and stream every
100 ms). The integration channels and their events are listed under [Integrations](#integrations-phase-1).

### Adding a channel

1. Add it to `InvokeChannels` (and `CortexApi`) in `src/shared/ipc.ts`.
2. Add its request schema to `schemas` in `src/shared/schemas.ts` (typecheck fails until it matches).
3. Register a handler with `handle(ctx, 'group:name', fn)` in `src/main/ipc/*`.
4. Forward it in `src/preload/index.ts` and add a fallback in `src/renderer/src/native.ts`.

New groups can be added without touching the existing lists, as Phase 1 did: a second
`interface InvokeChannels { … }` / `EventChannels` / `CortexApi` block in `ipc.ts` (declaration merging),
a schema map spread into `schemas`, and a forwarding module spread into the preload's `api`.

## Persistence (Phase 0a, interim)

`persist.ts` loads `{version: 0, items, links}` before the first render (seed when empty) and saves it
500 ms after changes (and on unload). Main only stores JSON; schema validation and migrations belong to
the renderer (Phase 0b). Notification / sound toggles are still in localStorage.

## Where things live

| | |
|---|---|
| Workspace file | `<userData>/workspace.json` (+ `.bak`); Windows `%APPDATA%\cortex` |
| Window state | `<userData>/window-state.json` |
| Build output | `out/main`, `out/preload/index.cjs`, `out/renderer` |
| Static assets | `public/` (renderer `publicDir`); reference them with `asset('brand/…')` from `native.ts`, not `/brand/…`, so they resolve under `file://` too |
| Separate profile | `CORTEX_USER_DATA=<dir>` |
| Headless bridge check | `CORTEX_SMOKE=1 npm run dev` (`src/main/smoke.ts`; `CORTEX_SMOKE_GH_REPO=owner/name` adds a read-only `gh pr list`) |
| Jira mock data | `<userData>/jira-mock.json` (seeded on first use) |
| Claude session metadata | `<userData>/claude-sessions.json` |

## Integrations (Phase 1)

Real tools, called from main, never through a shell (except the user's own app / test command lines).
Layout:

| | |
|---|---|
| `src/shared/integrations/*.ts` | dependency-free types the renderer may import: tool-shaped DTOs (gh JSON, Jira REST v3, Claude stream-json), pure parsers / mappers (`summarizePr`, `rollupChecks`, `summarizeIssue`, `adfToMarkdown`, the Claude reducer `applyClaudeEvent`, `parseTestSummary`, `detectLocalUrl`), `DEFAULT_CONFIG` |
| `src/main/services/*.ts` | `GitService`, `GhService`, `JiraService`, `ClaudeSessions`, `AppRunner` / `TestRunner`; each takes an injectable `Runner` (tests) and throws `CliError` (exit code + stderr in the message) |
| `src/main/ipc/integrations.ts` | the handlers; `src/shared/integrationSchemas.ts` the zod schemas (spread into `schemas`) |
| `src/preload/integrations.ts` | forwarding; `native.ts` has rejecting browser fallbacks (`list()` calls resolve `[]`) |

Renderer: `native.git.status(dir)`, `native.gh.prView(repo, n)`, … and `native.on('claude:state', cb)` (typed,
returns unsubscribe; unknown channels throw). Request strings that end up as git / gh arguments (refs,
branches, remotes, labels) are rejected when they start with `-`, so they can't be read as options.

### git — `git` on PATH

| Channel | Request → response | Command |
|---|---|---|
| `git:isRepo` | `{dir}` → `boolean` | `git rev-parse --is-inside-work-tree` |
| `git:currentBranch` | `{dir}` → `string \| null` (null = detached) | `git symbolic-ref --quiet --short HEAD` |
| `git:remoteRepo` | `{dir, remote?}` → `owner/name \| null` | `git remote get-url origin` (https / ssh / scp forms) |
| `git:worktreeList` | `{repoDir}` → `GitWorktree[]` | `git worktree list --porcelain` |
| `git:worktreeAdd` | `{repoDir, path, branch, base?, newBranch?}` → `GitWorktree` | `git worktree add -b <branch> <path> <base>` / `git worktree add <path> <branch>` |
| `git:worktreeRemove` | `{repoDir, path, force?}` | `git worktree remove [--force] <path>` |
| `git:status` | `{dir}` → `GitStatus` (branch, upstream, ahead / behind, files with XY status, `rebasing`) | `git status --porcelain=v2 --branch -z --untracked-files=all` |
| `git:diff` / `git:diffStat` | `{dir, base?, staged?}` → unified diff / `{files, additions, deletions}` | `git diff [--merge-base <base> \| --cached]` / `--numstat -z` |
| `git:log` | `{dir, range?, limit?}` → `GitLogEntry[]` | `git log --format=… -n <limit> [<range>]` |
| `git:fetch` | `{dir, remote?, prune?}` | `git fetch [--prune] <remote \| --all>` |
| `git:rebase` | `{dir, onto}` → `{ok: true} \| {ok: false, conflicts}` | `git rebase <onto>`; on conflicts the rebase is left stopped |
| `git:rebaseAbort` | `{dir}` | `git rebase --abort` |

All git calls run with `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0` (never wait for an editor or a password).

### GitHub — `gh` on PATH (must be logged in: `gh auth status`)

| Channel | Command |
|---|---|
| `gh:prList {repo, author?, app?, search?, state?, label?, head?, base?, limit?}` → `GhPrListItem[]` | `gh pr list --repo … --json GH_PR_LIST_FIELDS` |
| `gh:prView {repo, number}` → `GhPullRequest` | `gh pr view --json GH_PR_FIELDS` (incl. `statusCheckRollup`, `mergeable`, `mergeStateStatus`, `files`, `comments`, `latestReviews`) |
| `gh:prCreate {dir, title, body, base, head, draft?, repo?}` → `{number, url}` | `gh pr create` in `dir`; stacked PR = `base` is the parent PR's head branch. The head branch must be pushed already |
| `gh:prMerge {repo, number, method, deleteBranch?}` | `gh pr merge --merge\|--squash\|--rebase [--delete-branch]` |
| `gh:prComment {repo, number, body?}` → `{url?}` | `gh pr comment --body …`; without `body` the AI-review trigger (`config.github.aiReviewComment`, default `@claude review`) |
| `gh:prUpdateBranch {repo, number, rebase?}` → `{ok, message} \| {ok: false, conflicts, message}` | `gh pr update-branch --rebase` (conflicts → result, other failures throw) |
| `gh:prDiff {repo, number}` → `string` | `gh pr diff --color never` |
| `gh:prChecks {repo, number}` → `GhCheck[]` | `gh pr checks --json GH_CHECK_FIELDS` (exit 8 = pending and 1 = failed still parse; "no checks reported" → `[]`) |
| `gh:runView {repo, runId}` → `GhRun` | `gh run view --json GH_RUN_FIELDS` (incl. jobs) |
| `gh:runRerun {repo, runId, failedOnly?}` | `gh run rerun [--failed]` |
| `gh:renovatePrs {repo}` → `GhPrListItem[]` | `gh pr list --app renovate` ∪ `--label renovate` |

Field lists live in `shared/integrations/github.ts` (verified against gh 2.102). Mappers: `summarizePr` →
`PrSummary` (state incl. draft / approved / changes-requested, checks roll-up, `behind`, `conflicts`),
`updateTypeOf` / `isRenovatePr` for Renovate. Live read-only test: `CORTEX_LIVE_GH=1 npx vitest run src/main/services/gh.test.ts`.

### Jira — `scripts/jira-mock` (Atlassian CLI surface)

| Channel | Command (`<cli> jira workitem …`) |
|---|---|
| `jira:search {jql, limit?}` → `JiraIssue[]` | `search --jql "<jql>" --json [--limit N]` |
| `jira:view {key}` → `JiraIssue` | `view <KEY> --json --fields *all` |
| `jira:transition {key, status}` | `transition --key <KEY> --status "<status>" --yes` |
| `jira:create {project, type, summary, description?, assignee?, parent?}` → `JiraIssue` | `create --project X --type Story --summary … --json` |
| `jira:comment {key, body}` → `JiraComment \| null` | `comment create --key K --body … --json` |
| `jira:edit {key, summary?, description?, assignee?, labels?}` | `edit --key K [--summary …] [--description …] --yes` |

The mock (`scripts/jira-mock/jira-mock.mjs`, plain ESM, no build) prints Jira Cloud REST v3 issue JSON (ADF
descriptions / comments, `status.statusCategory`, `issuetype`, `priority`, `assignee`, `labels`, `parent`,
`issuelinks`, `customfield_10016` story points, `customfield_10020` sprint, `self` =
`https://example.atlassian.net/rest/api/3/issue/<id>`). JQL subset: `AND` of `field op value` with `=`,
`!=`, `in`, `not in`, `is [not] EMPTY`, `~`; fields assignee / reporter (`currentUser()`), project, status,
statusCategory, key, type, priority, labels, parent, summary, text, sprint (`openSprints()`); `ORDER BY` is
ignored (sorted by `updated`); `OR` is rejected. Workflow: To Do → In Progress → In Review → Done, back
steps, Blocked from / to the open states, Done → To Do. Errors go to stderr with exit 1 (usage: 2). Data:
`JIRA_MOCK_DB` (main passes `<userData>/jira-mock.json`), seeded with the canvas seed's CTX tickets.

Main runs it as `<process.execPath> <app>/scripts/jira-mock/jira-mock.mjs` with `ELECTRON_RUN_AS_NODE=1`
(no node on PATH needed). `exec:run` with `cmd: 'jira-mock'` maps to the same command. When packaging (electron-builder, deferred) `scripts/jira-mock/` must ship unpacked next to the app.

**Swapping in the real Atlassian CLI:** install `acli`, `acli jira auth login`, then start Cortex with
`CORTEX_JIRA_CLI=acli`. `JiraService` sends the same arguments to `acli`. Things to check then: the custom
field ids (`JIRA_FIELDS` in `shared/integrations/jira.ts`), the workflow's status names, and the shape of
`search --json` (the service accepts an array or `{issues: […]}`).

### Claude Code — `claude` on PATH

One long-lived process per session:
`claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio
--session-id <uuid> | --resume <id> [--model] [--effort] [--permission-mode] [--add-dir …] [--append-system-prompt]`
(flags checked against Claude Code 2.1.323). User messages go to stdin as `{type: 'user', message}` lines;
each stdout line is an event, stamped, kept as the transcript, folded with `applyClaudeEvent` and pushed.

| Channel | Notes |
|---|---|
| `claude:start ClaudeStartRequest` → `ClaudeSessionSummary` | `{cwd, prompt?, title?, model?, effort?, permissionMode?, resume?, addDirs?, appendSystemPrompt?, localId?}`; returns the `localId` |
| `claude:send {localId, text}` | next user message; with no process attached (stopped, app restarted) it respawns with `--resume <session id>` first |
| `claude:answer {localId, toolUseId, answers}` → `{via: 'tool' \| 'message'}` | answers an AskUserQuestion (see below) |
| `claude:permission {localId, requestId, decision}` | allow / deny a pending tool permission prompt |
| `claude:interrupt {localId}` | `control_request {subtype: 'interrupt'}`; the turn ends, the process stays (status `idle`, activity "Interrupted") |
| `claude:stop {localId}` / `claude:remove` | close stdin (tree-kill after 2 s) / also forget the session |
| `claude:list` / `claude:transcript` / `claude:session` | summaries / raw events (after a restart: read from `~/.claude/projects/<slug>/<id>.jsonl`) / full session with messages |
| events `claude:event {localId, event}`, `claude:state ClaudeSessionSummary` | status `starting · running · waiting · idle · done · failed`, `pendingQuestion`, `pendingPermissions`, `activity`, `lastText`, `usage` (tokens, context, cost, turns) |

**AskUserQuestion.** With `--permission-prompt-tool stdio` the CLI asks the host before it runs a tool:
a stdout line `{type: 'control_request', request_id, request: {subtype: 'can_use_tool', tool_name,
input, tool_use_id}}`. For `AskUserQuestion` the manager parks that request by `tool_use_id`; `answer()`
replies `{type: 'control_response', response: {subtype: 'success', request_id, response: {behavior:
'allow', updatedInput: {...input, answers: {"<question>": "<label>"}}}}}` (multi-select joined with
", "). The CLI then runs the tool with those answers and emits its `tool_result` itself, exactly as with the
Agent SDK's `canUseTool`. The protocol (request fields, the `answers` input field, allow / deny shapes,
`interrupt`) was read from the installed CLI's own schemas; it is exercised end-to-end only with the fake
CLI (`src/main/services/__fixtures__/fake-claude.mjs`), not a paid session. Fallback when no request was
parked for that tool use: the answers are sent as the next user message. A typed `send()` while a question
is open denies the question first. Other tools' prompts appear in `pendingPermissions` (depends on
`--permission-mode`; `acceptEdits` / `bypassPermissions` reduce them). Other host requests (hooks, MCP,
elicitation) are answered with an error response so the CLI never hangs.

Cost: `total_cost_usd` is cumulative per process, so each result adds its delta (`usage.processCostUsd`).
Session metadata (`localId`, Claude `session_id`, cwd, title, model, permission mode, cost) is stored in
`<userData>/claude-sessions.json`. Binary: `CORTEX_CLAUDE_BIN` (tests inject `node <fake script>`).

### Apps and test runs — the user's command line, through the shell

| Channel | Notes |
|---|---|
| `apps:start {id, cwd, command, env?, urlHint?}` → `AppState` | `starting` → `running` once a local URL is printed (`http://localhost:N`, `127.0.0.1`, `0.0.0.0`/`[::]` → localhost) or after 8 s alive; `exited` (stopped / exit 0) or `crashed` |
| `apps:stop` / `apps:restart` / `apps:list` / `apps:log` / `apps:remove` | `log` = last 256 KB |
| `tests:run {id, cwd, command, env?}` → `TestState` | `running` → `passed` / `failed` / `error` (stopped, spawn failure) with `summary` (vitest, jest, pytest, go test, mocha, TAP / `node --test`; best effort) |
| `tests:stop` / `tests:list` / `tests:log` | |
| events `app:state`, `app:output`, `test:state`, `test:output` | output batched per id + stream every 100 ms (`OutputBatcher`, also used for `proc:output` now) and flushed before the exit / state |

### Config knobs (env, read once at start: `src/main/services/config.ts`)

`CORTEX_JIRA_CLI=mock|acli`, `CORTEX_JIRA_MOCK_SCRIPT`, `JIRA_MOCK_DB`, `JIRA_MOCK_SITE`, `CORTEX_CLAUDE_BIN`,
`CORTEX_AI_REVIEW_COMMENT`, `CORTEX_RENOVATE_APP`. Defaults in `shared/integrations/config.ts`
(`integrations:config` returns the effective values).
