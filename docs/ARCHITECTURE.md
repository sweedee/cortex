# Architecture

Cortex is an Electron app built with electron-vite. Three processes, one window.

```
┌──────────── main (Node) ────────────┐   ipcMain.handle / webContents.send
│ src/main/index.ts   lifecycle        │◄──────────────────────────────────┐
│ src/main/window.ts  BrowserWindow    │                                   │
│ src/main/ipc/*      handlers (zod)   │                                   │
│ src/main/services/* git gh jira …    │                                   │
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
src/shared/integrations/*  tool DTOs and pure mappers both sides may import
```

## Rules

1. **The renderer never touches Node or `window.cortex` directly.** All native access goes through
   `src/renderer/src/native.ts`, which also provides a browser fallback (`npm run dev:web`, unit tests):
   exec / proc / fs / integrations reject with a clear error (lists resolve `[]`), the workspace lives in
   localStorage, notifications use the Web Notification API.
2. **Every invoke channel is declared in `src/shared/ipc.ts` and validated in main** with its schema in
   `src/shared/schemas.ts` / `integrationSchemas.ts` (a compile-time check keeps schemas and types in sync).
   Handlers are registered with `handle()` (`src/main/ipc/handle.ts`), which also rejects callers other
   than the app window.
3. **The preload only forwards.** It is sandboxed, so it may only import `electron` and the dependency-free
   `shared/ipc.ts` (types). Never expose `ipcRenderer` itself.
4. **No shell for programmatic commands.** `exec.run` and the services spawn via `cross-spawn` (resolves
   Windows `.cmd` shims, escapes args) with `shell: false` and an allowlist. Only the user's own command
   lines (a project's start / test command) run through a shell.
5. **Logic that can live outside Electron does** (`src/main/lib/*`, `src/main/services/*` with an
   injectable runner, `src/shared/integrations/*`): it is unit-tested in node without an Electron runtime.

## Window

Dark background (`#07080f`), `contextIsolation`, `sandbox`, no `nodeIntegration`, `webviewTag: true`
(GitHub, Jira, running apps and deployments are embedded as `<webview>` guests; attached webviews are
stripped of preload / node and their popups go to the OS browser). Bounds are saved to
`<userData>/window-state.json`. `window.open` / `target=_blank` and navigations away from the app open in
the OS browser (http/https only). Single-instance lock.

**Content-Security-Policy**: a `<meta>` tag injected by the `cortex-csp` Vite plugin
(`electron.vite.config.ts`). The build (file://) allows only the app's own scripts (`script-src 'self'`, no
remote code, no eval), inline styles (Strato, CodeMirror, mermaid), `data:` / `blob:` images, fonts and
workers, and Strato's fonts from `dt-cdn.net`; `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
Dev additionally allows the Vite dev server and its HMR socket on localhost and react-refresh's inline
preamble. Webview guests are separate pages and keep their own policies. `CORTEX_SMOKE_GALLERY=1` checks
that mermaid, CodeMirror and the diff viewer render under it (see [Smoke runs](#smoke-runs)).

## IPC channels

| Channel | Request → response | Notes |
|---|---|---|
| `exec:run` | `{cmd, args, cwd, env?, timeoutMs?, stdin?}` → `{code, stdout, stderr, timedOut}` | `cmd` ∈ `git gh claude node jira-mock` (`jira-mock` → the configured Jira CLI); no shell; tree-killed on timeout (default 120 s) |
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
which returns an unsubscribe function. Output events are batched (one per process and stream every
100 ms). The integration channels (`git:*`, `gh:*`, `jira:*`, `claude:*`, `apps:*`, `tests:*`) are listed
under [Integrations](#integrations).

### Adding a channel

1. Add it to `InvokeChannels` (and `CortexApi`) in `src/shared/ipc.ts` (request / response types next to it).
2. Add its request schema to `schemas` in `src/shared/schemas.ts` (or `integrationSchemas.ts`); typecheck
   fails until it matches.
3. Register a handler with `handle(ctx, 'group:name', fn)` in `src/main/ipc/*` (logic in a service or `lib/`).
4. Forward it in `src/preload/index.ts` / `integrations.ts` and add it to the fallback in `native.ts`.
5. Wrap it in the renderer's `data/<service>.ts`: a query hook for reads, an op that invalidates what it
   changed for writes.

`gh:prEdit` is a small example of all five steps. New groups can be added without touching the existing
lists: a second `interface InvokeChannels { … }` / `EventChannels` / `CortexApi` block in `ipc.ts`
(declaration merging), a schema map spread into `schemas`, and a forwarding module spread into the
preload's `api`.

## Renderer

```
src/renderer/src/
  domain/      pure model: zod schemas (source of truth), inferred types, migrations, graph helpers
  kinds/       kind registry: registry.ts, types.ts (KindModule), common.tsx (shared actions + helpers),
               icons.tsx, and one folder per kind (see Kinds)
  sidebar/     sidebar building blocks (SidebarTabs, SidebarSection, SummarySection, FactsSection,
               ConnectionsSection, DefaultSidebar); overlays/Sidebar.tsx is the shell
  components/viewers/  Markdown (+ mermaid), DiffViewer, CodeEditor, WebPanel, LogView (own README)
  data/        TanStack Query: queryClient.ts, queryKeys.ts, ops.ts, one file of hooks + write ops per integration
  sync/        live events → items (live.ts), startup reconciliation, background refresher, pure mappings
  ui/          toolkit for kind modules: form.tsx (openForm), formModel.ts, task.tsx (runTask, openUrl, …)
  chat/        ChatBox.tsx (SKILLS list, @ / / / # popups), prompt.ts (prompt + context, cwd resolution)
  overlays/    Hud.tsx, Sidebar.tsx (shell), Dialogs.tsx (add / confirm), settings.ts (global settings form)
  store.ts     zustand store + the function API (select, patchItem, patchData, notify, insertSkill, …)
  persist.ts   workspace load (migrate + validate) and debounced autosave
  layout.ts    d3-force simulation; positions live here, not in the store
  actions.tsx  selection-level actions, chat send (sendPrompt)
  desktop.ts, sound.ts  OS notifications and chimes for new notices
  debug.ts     the smoke harness's handle (dev, or a build opened as #smoke)
  visual.ts    group colours; tones.ts: tone → colour maps, "x min ago"
  canvas/      canvas, bubbles, links, backdrop, hover card, inline actions
```

Import direction (keep it acyclic): `domain` ← `store` ← `kinds/common`, `sidebar` ← `kinds/<kind>` ←
`kinds/registry` ← UI. The store and `layout.ts` never import the registry: what the store needs to know
about kinds (ring tones and search text for the filter, hierarchy levels) is handed to it with
`provideKindInfo()` when `kinds/registry.ts` is imported (`main.tsx` does that first; tests that use the
filter import it too). Kind modules must not import `kinds/registry` or `visual.ts`; to reach another kind
use `ctx.kind(k)`. `sync/` may import a kind's *pure* helpers (`kinds/build/logic`, `kinds/pr/builds`,
`kinds/record/discovery`).

### Domain model

Everything on the canvas is an `Item`: a discriminated union on `kind`
(`domain/schemas.ts` → `ItemSchema`, types in `domain/types.ts`, `ItemOf<'pr'>`, `DataOf<'pr'>`).

Common fields: `id`, `kind`, `handle` (what `@` mentions), `title`, `projectId?` (owning project, also the
layout cluster), `archived?`, `notice? {text, tone, at, read?}`, `createdAt`, `updatedAt`, `pos? {x, y}`
(where the user dropped the bubble; pinned until *Auto-arrange*).

| kind | `data` (cached for the ring / hover card only) |
|---|---|
| project | `repo` (owner/name), `baseDir?`, `worktreesDir?`, `defaultBranch`, `startCommand?`, `testCommand?`, `stats? {mainChecks, openPrs, renovatePrs}` |
| ticket | `key`, `status` (Jira name), `statusCategory` (new / indeterminate / done), `type`, `priority?`, `assignee?`, `sprint?`, `points?`, `branch?` |
| worktree | `path`, `branch`, `baseBranch`, `ticketKey?`, `git? {ahead, behind, dirty, changedFiles, checkedAt?}` |
| record | `recordType` (plan / brainstorm / grill / verification), `path` (`<baseDir>/records/<ticket-branch>/<name>.md`), `ticketBranch?`, `ticketKey?`, `status` (draft / approved / done), `steps? {done, total}`, `author?` |
| pr | `repo`, `number`, `headBranch`, `baseBranch`, `state` (open / closed / merged), `isDraft`, `author?`, `reviewDecision?`, `reviews? {approved, requested}`, `mergeable?`, `mergeStateStatus?` (GitHub's; `DIRTY` = conflicts), `checks? {state, passed?, failed?, pending?}`, `additions?`, `deletions?`, `stackedOn?` (PR item id) |
| agent | `sessionId?`, `localId?` (session in main; unset = demo), `cwd`, `model?`, `status` (running / waiting / idle / done / failed), `skill?`, `pendingQuestion? {toolUseId, questions[{question, header?, options[{label, description?}], multiSelect?}]}`, `pendingPermissions? [{requestId, toolName, summary?}]`, `error?`, `lastActivity?`, `startedAt?`, `endedAt?`, `usage? {contextPct, costUsd, turns}` |
| app | `command`, `cwd`, `url?`, `port?`, `procId?`, `state` (starting / running / stopped / crashed), `worktreeId?` |
| build | `repo`, `name`, `url`, `runId?`, `number?`, `state` (queued / in_progress / completed), `conclusion?`, `prNumber?`, `branch`, `stage?`, `trigger?`, `durationSec?` |
| deployment | `url`, `stage` (dev / staging / prod / custom), `stageLabel?`, `health?` (mocked), `version?` |
| todo | `body` (markdown), `done` |
| testrun | `command`, `cwd`, `procId?`, `state` (idle / running / passed / failed / stopped), `summary? {passed, failed, skipped}`, `outputTail?` (max 8000 chars), `worktreeId?`, `startedAt?`, `endedAt?` |

Rule: items only cache what the canvas needs to draw. Diffs, transcripts, full Jira issues, PR details and
logs come from TanStack Query hooks and are never persisted. Visuals (ring, subtitle, facts, short text,
badge) are *derived* from `data` by the kind module; nothing display-only is stored.

Mutate with the store API: `patchData(item | id, partialData, commonPatch?)` for `data`,
`patchItem(id, commonPatch)` for common fields, `addItem(newItem, links)` (stamps id and timestamps via
`makeItem`), `notify(id, {text, tone})`, `setArchived`, `removeItems`, `restoreItems(snapshot)` (undo).

### Kind registry

`kinds/types.ts` defines `KindModule<K>`:

| field | |
|---|---|
| `kind`, `label`, `icon(size)` | identity |
| `radius`, `level` | bubble size; hierarchy (0 = project … 4 = build / testrun), drives layout spacing and colour roll-up |
| `ring(item, ctx)` → `Segment[]` | status ring, derived from `data` (+ related items via `ctx`); filters and status buckets use it |
| `facts(item, ctx)` → `[k, v][]`, `subtitle(item, ctx)`, `short?(item)` | hover card / sidebar text; the subtitle is also searched |
| `badge?(item)` → `{label, tone}` | chip under the bubble (deployment stage) |
| `titleInside?`, `waiting?(item)` | title inside the disc (projects); pulse when the user is needed |
| `actions(items, ctx)` → `Action[]` | kind actions (today always one item); `primaryAction?(item, ctx)` overrides which one is primary |
| `complete?(item)` → data patch | present = the kind gets *Mark done* (patch, then archive) |
| `Sidebar?` | details body; default `DefaultSidebar` |
| `addable?` `{label, hint, multiline?, detect?(input), create(input, project), open?(at)}` | canvas *Add* menu, add dialog, paste detection; `open` replaces the add dialog with a custom flow (project → settings form, todo → quick form, agent → chat box) |

`ctx` (`KindCtx`, cached per items/links change): `items`, `links`, `get(id)`, `getAs(id, kind)`,
`linked(id, kind?)`, `inProject(projectId, kind?)`, `projectOf(item)`, `kind(k)`.

Registry helpers (`kinds/registry.ts`): `getKind`, `kindIcon`, `kindLabel`, `levelOf`, `radiusOf`,
`ctxOf` / `useCtx`, `viewsOf` / `useViews` (per-item `{ring, short, badge, subtitle, waiting, running}`,
cached), `factsOf`, `sidebarOf`, `actionsForItem` (kind actions + *Mark done* + *Archive*; archived items
get *Unarchive* + view / external actions only).

#### How to add a kind

1. `domain/schemas.ts`: add the name to `KINDS`, a `<Kind>DataSchema`, an entry in `ItemSchemas` and in
   `ItemSchema`. A new kind needs no migration; an incompatible change to an existing data shape does
   (bump `WORKSPACE_VERSION`, see below). Optional fields can be added without one.
2. `domain/types.ts`: export the data type (optional).
3. `kinds/<kind>/index.tsx`: export a `KindModule<'<kind>'>`. Build actions inside `actions()`; import only
   from `domain`, `store`, `layout`, `native`, `data`, `ui`, `tones`, `kinds/common`, `kinds/icons`, `sidebar`,
   `components/viewers`.
4. `kinds/registry.ts`: add it to `MODULES` (typecheck fails until every kind has a module).
5. Add a seed example and run `npm test` (the registry test checks every kind and every seed item).

### Store

zustand (`create` + `subscribeWithSelector`) in `store.ts`; components read with `useStore(selector)`
(selectors must return stable values: cache derived ones, like `visibleSet`, `viewsOf` and `ctxOf` do).
Everything else uses the exported functions. Positions stay in `layout.ts`; only dropped positions are
written to the items (`pos`) on drag end. Settings: `settings` (`model`, `permissionMode`,
`aiReviewComment`, `refreshSec`, `sidebarWidth`) + `setSettings(patch)`; `desktopNotify` / `soundOn` have
their own setters.

### Workspace file and migrations

`<userData>/workspace.json`:

```jsonc
{
  "version": 2,
  "items": [ /* Item */ ],
  "links": [ { "id": "l1", "from": "t-4821", "to": "p-ingest", "label": "in project" } ],
  "prefs": {
    "desktopNotify": false, "soundOn": true, "colorBy": "project", "filter": { /* Filter */ },
    // a bad value falls back to its default
    "model": "claude-…",            // optional; unset = the Claude CLI's default
    "permissionMode": "default",    // claude --permission-mode for new sessions ("default" = no flag)
    "aiReviewComment": "@claude review", // optional; unset = main's config
    "refreshSec": 60,               // background refresher cadence
    "sidebarWidth": 360             // details sidebar width (drag its left edge)
  },
  "camera": { "x": 0, "y": 0, "k": 1 }   // optional, reserved
}
```

`persist.ts` loads it before the first render: `parseWorkspace(raw)` (`domain/migrations.ts`) runs
`migrate()` (step by step: `MIGRATIONS[n]` turns version n into n+1), then validates with zod.

- Single invalid items and dangling links are dropped (console warning + toast); an outdated
  `prefs.filter` is dropped.
- A file that is not a workspace, or comes from a newer app version: demo data, a copy is written as
  `workspace.invalid-<time>.json`, warning toast. Unreadable JSON: main falls back to `.bak` first.
- A migrated file is saved right away (the old one becomes `.bak`).
- Autosave: 500 ms after a change of items, links or prefs, and on unload.

Versions: v0 had display-only items (`status`, `facts`, `subtitle`, `flags`, `cluster`, `notice.ago`) and
prefs in localStorage; v0 → v1 parses those strings into typed `data`, `plan` → `record`, `cluster` →
`projectId`, `notice.ago` → `notice.at`, and carries the localStorage prefs over. v1 → v2 adds the settings
prefs with their defaults; agent data gains the optional `localId`, `pendingPermissions` and `error`.
Fixtures: `domain/fixtures/workspace-v0.json`, `workspace-v1.json`.

Adding a version: bump `WORKSPACE_VERSION`, add `MIGRATIONS[old]`, a fixture of the old format and a test.
Never edit an existing step.

## Remote data (TanStack Query)

Live data from integrations is read with TanStack Query; the `QueryClient` (`data/queryClient.ts`) is
provided in `main.tsx`. Pattern:

- **Keys** only from the factory in `data/queryKeys.ts`: `[integration, resource, ...params]`
  (`qk.gh.pr(repo, n)`), so invalidation can target an integration (`qk.gh.all`), a resource or one entity.
- **One file of hooks per integration** in `data/` (`data/gh.ts`, `data/git.ts`, …), each hook wrapping a
  `native.*` call. Hooks take possibly-undefined params and only run in the desktop app with every param
  set (`ready()` in `data/ops.ts`).
- **Invalidate after actions**: write ops invalidate what they change.
- **Poll running things** with `refetchInterval` (a running build, agent or test run).
- **Write back what the ring needs**: when a query result changes a cached field (PR checks, git stats,
  run state), `patchData()` the item so the canvas (and the next start) shows it; everything else stays in
  the cache.
- Defaults: `staleTime` 30 s, no refetch on window focus, one retry.

### Data hooks and write ops

Reads are hooks; writes are plain async functions in a `<service>Ops` object (kind actions run outside
React) that invalidate what they change. In a component, `useOp(ghOps.prMerge)` gives a mutation
(`m.mutate([repo, n, 'squash'])`, `m.isPending`, `m.error`).

| file | hooks | ops |
|---|---|---|
| `data/git.ts` | `useGitStatus(dir)`, `useGitDiff(dir, base?)`, `useGitDiffStat(dir, base?)`, `useGitLog(dir, {range, limit})`, `useCurrentBranch(dir)`, `useRemoteRepo(dir)`, `useWorktrees(repoDir)` | `gitOps.worktreeAdd(repoDir, path, branch, base?, {newBranch})`, `worktreeRemove(repoDir, path, {force})`, `fetch(dir)`, `rebase(dir, onto)`, `rebaseAbort(dir)`, `push(dir, {setUpstream})`, `detect(dir)` → `{repo, branch}` \| null |
| `data/gh.ts` | `usePr(repo, n)`, `usePrSummary(repo, n)`, `usePrDiff(repo, n)`, `usePrChecks(repo, n)` (polls while pending), `usePrList(repo, filter)`, `useRenovatePrs(repo)`, `useRun(repo, runId)` (polls until completed) | `ghOps.prCreate(req)`, `prMerge(repo, n, method, {deleteBranch})`, `prComment(repo, n, body)`, `requestAiReview(repo, n)` (uses the `aiReviewComment` setting), `prUpdateBranch(repo, n, {rebase})`, `prEdit({repo, number, base?, title?, body?})`, `runRerun(repo, runId, {failedOnly})` |
| `data/jira.ts` | `useJiraIssue(key)`, `useJiraIssueSummary(key)`, `useJiraSearch(jql, limit?)` | `jiraOps.transition(key, status)`, `create(req)`, `comment(key, body)`, `edit(req)`; `jiraUrl(key)` = the browse URL (cached issue's `self`, else the configured site, else the mock's): the one place that builds Jira links |
| `data/claude.ts` | `useClaudeSessions()`, `useClaudeSession(localId)` (messages, status, usage), `useClaudeTranscript(localId)` (raw events, appended live) | `claudeOps.start(req)`, `send(localId, text)`, `answer(localId, toolUseId, answers)`, `permission(localId, requestId, decision)`, `interrupt`, `stop`, `remove` |
| `data/apps.ts` | `useApps()`, `useAppLog(id)` (appended live) | `appOps.start(req)`, `stop(id)`, `restart(id)`, `remove(id)` |
| `data/tests.ts` | `useTestRuns()`, `useTestLog(id)` (appended live) | `testOps.run(req)`, `stop(id)` |
| `data/app.ts` | `useAppInfo()`, `useIntegrationConfig()` | `loadIntegrationConfig()` (the same config outside React; prefetched by `startSync`) |

Keys (`data/queryKeys.ts`) nest so prefixes invalidate groups: `qk.gh.pr(repo, n)` covers its diff and checks,
`qk.gh.prs(repo)` every PR list, `qk.git.dir(dir)` status / diff / log of one checkout, `qk.jira.searches()`
every search, `qk.claude.session(id)` its transcript.

Ids: an agent's session id in main is `data.localId` (the chat box uses the item id); apps and test runs use the
item id as runner id and store it as `data.procId`. Live sync matches events by these.

### Live sync, reconciliation, background refresh (`sync/`)

`startSync()` (main.tsx, desktop only):

- **Live events** (`sync/live.ts`): `claude:state` → the agent with that `localId` (status, `pendingQuestion`,
  `pendingPermissions`, activity, usage, error); `app:state` / `test:state` → the app / test run with that
  `procId` (state, url / port; state, summary, `outputTail`). Mappings are pure (`sync/mapping.ts`). Notices on
  transitions: agent asks / needs permission → warning, agent finished → success, agent failed / app crashed /
  tests failed → critical, tests passed → success. `claude:event` / `app:output` / `test:output` are appended to
  the transcript / log caches; the session query is refetched (debounced) on state changes.
  Agent status mapping: claude `idle` (turn done, process alive) → `done`, interrupted → `idle`; process gone
  mid-turn → `idle`.
- **Reconcile** at start: items that were really started (`localId` / `procId`) and say they run, but main does
  not know them (the app restarted), become idle / stopped; known ones take main's state, without notices.
  Demo items (no ids) are left alone.
- **Refresher** (`sync/refresher.ts`): every `settings.refreshSec` (default 60 s; 15 s for open PRs with
  pending checks and for running builds), only while the window is visible: worktree → `git status` +
  ahead / behind `origin/<base>`; open PR → `gh pr view` (state, review, mergeable, mergeStateStatus, checks
  with counts); ticket → `jira view` (status, category, assignee, sprint, points, title); project → open /
  Renovate PR counts; build that is not completed → `gh run view` for GitHub Actions run ids, else the linked
  PR's `gh pr checks` (one call per PR updates all its build bubbles). Results also seed the query caches;
  unchanged values don't touch the store. Non-absolute paths (`~/…` demo data) are skipped; failures log
  once and back off exponentially per item and per gh repo (up to 30 intervals).
- **Record discovery** (`kinds/record/discovery.ts`): see [record](#record).

### Chat box → Claude Code

`sendPrompt(text, mentionedIds)` (`actions.tsx`, logic in `chat/prompt.ts`):

1. Exactly one mentioned agent with a session (`localId`) → `claude:send` to it (follow-up).
2. Otherwise a new session: cwd = `resolveCwd(mentions)`: a mentioned worktree > a worktree linked to (or with the
   ticket key of) a mention > a mentioned app / test run / agent dir > the project's `baseDir`; absolute paths only.
   None → a small form: pick a configured project or any folder (native picker).
3. Prompt = `buildPrompt`: the draft as typed (a leading `/skill` stays the slash command) + a context block, one
   line per mention, e.g. `- @CTX-4821 = Jira ticket CTX-4821 "Retry …" (In Progress, Story, branch feat/…)`.
4. An agent item is created (`localId` = item id, handle `agent/<skill>-<ticket key>`, linked `about` the mentions
   and `belongs to` the project), then `claude:start {localId, cwd, prompt, title, model, permissionMode}` with
   `settings.model` (unset = CLI default) and `settings.permissionMode` (`default` = no flag). The draft clears
   once sent; a toast offers *Open*.

The chat box popups: `@` mentions (matching bubbles light up), `/` skills from the `SKILLS` list in
`chat/ChatBox.tsx` (every skill a kind action inserts is listed there with a one-line description), `#` / `!`
the actions of the mentioned bubbles.

## Toolkit for kind modules

Everything a kind module needs besides `data/*`:

```ts
// ui/form.tsx: a modal form, rendered by <FormHost/> (mounted once); stacks over other dialogs
openForm({
  title: string, description?: string, submitLabel?: string, danger?: boolean,
  fields: { name, label, type: 'text'|'textarea'|'select'|'checkbox'|'directory'|'file'|'radio'|'info',
            options?: (string | {value, label, hint?})[], required?, default?, hint?, placeholder?,
            validate?: (value, values) => string | undefined, when?: (values) => boolean,
            filters?: {name, extensions}[] /* file */, rows? /* textarea */ }[],
  values?: Partial<FormValues>,                         // initial values
  onChange?: (name, values) => Partial<FormValues> | void | Promise<…>,   // derived fields
  onSubmit: (values: FormValues) => void | Promise<void>,  // throw → error shown, dialog stays open
}): Promise<FormValues | null>                          // null = cancelled
// FormValues = Record<string, string | boolean>; str(values, name) reads a string.
// directory / file fields have a "Browse…" button (native pickers); 'info' is a read-only line.
// Validation runs on submit, then live. formDriver (fill / submit the open form) is for the smoke harness.

// ui/task.tsx
runTask(label, promiseOrFn, { success?, message?, quiet? }): Promise<T | undefined>
  // spinner toast (only after 400 ms; ui/progressToast.ts) → success / critical toast; never rejects
errorText(e)                // readable message of a failed native call (no IPC wrapper / error class prefix)
openUrl(url) / openPath(path) / openInEditor(path)   // report failures as a toast instead of throwing

// kinds/common.tsx (action builders)
skill(id, label, skillName, extra?) · external(id, label, (item) => url, extra?)
openPathAction(id, label, (item) => path, extra?) · openInEditorAction(id, label, (item) => path, extra?)
toast(title, message?, type?) · archive(items, verb?, before?)   // archive shows an Undo toast

// sidebar/index.tsx
<SidebarTabs rememberAs="pr" initial="details" tabs={[{ id, label, render: () => node, wide?: boolean, badge? }]} />
<SidebarSection label="Changed files" actions={<Button …/>}>…</SidebarSection>   // actions sit right of the label
useSidebarLayout() → { wide, setWide(boolean), width }   // a webview / diff tab can go wide
SummarySection, FactsSection, ConnectionsSection, DefaultSidebar

// kinds/project: openProjectSettings(project?, at?) → the project's real paths / commands
// overlays/settings.ts: openSettings() → the global settings form (HUD gear)
```

The sidebar shell (`overlays/Sidebar.tsx`) is resizable (drag the left edge; persisted as `settings.sidebarWidth`)
and has an expand button (about 60 % of the window); a tab with `wide: true` expands it while active. It publishes
the space it takes as the CSS variable `--sidebar-space`, so the chat dock and the floating action list centre in
the canvas area left of it. Toasts sit top left, under the brand.

**"AI" actions** only insert a skill into the chat box (`skill()`); the user adds context and sends. **"UI"
actions** do the real thing through `openForm` / `runTask` / `data/*Ops`. Demo items (fake repos like
`unknown/…` or `ctx-observability/…`, non-absolute paths) disable real actions with a reason, and sidebars show
a hint instead of a spinner or an error.

## Kinds

One folder per kind in `kinds/`. The table is the overview; the sections below list what is not obvious.

| Kind | Actions (besides Mark done / Archive) | Sidebar |
|---|---|---|
| project | Create ticket (AI), Review Renovate PRs (AI), New worktree…, Open repo / folder / in editor, Settings… | repository setup, tickets, open PRs, worktrees on disk vs canvas, deployments |
| ticket | Plan / Brainstorm (AI), Change status…, Create worktree…, Open in Jira; Mark done walks the workflow | Details (fields, description, links, comments) · Jira (webview) |
| worktree | Create PR…, Rebase (AI), Launch app, Run tests, Review (AI), Open in editor / folder, Remove worktree… | Changes (diff) · Stats |
| record | plan → Grill, brainstorm → Plan, grill → Implement (AI), Approve, Open in editor / folder | live markdown with task boxes, editor |
| pr | Retarget onto … (stacked child of a merged parent), Merge…, Rebase, Request AI review…, Address review / Review PR / Write description (AI), Open on GitHub | Overview · Files · GitHub |
| agent | one per question option, Allow / Deny per permission, Interrupt, Stop, Send follow-up, Continue / Fork (AI), folder actions | Session (harness) · Details |
| app | Open in browser, Preview, Restart / Stop / Start, Show log, Open folder | Preview · Log · Details |
| build | Re-run… (Actions) or Open details / Open in Jenkins, Fix CI / Explain failure (AI) | Overview (jobs, steps) · Details / Jenkins (webview) |
| deployment | Open, Edit… | Details (mocked status) · Preview |
| todo | Edit, Mark done | title, markdown editor / preview |
| testrun | Re-run, Stop, View output, Fix failing tests (AI) | summary, failing tests, live log |

### project

`kinds/project/`: `Sidebar.tsx`, `settings.tsx` (the settings form, also the canvas *Add project…* flow: picking
the base checkout detects the GitHub repo from `origin`, the branch, a worktrees folder next to it and npm
`dev` / `start` / `test` scripts), `worktreeFlow.ts` (the "new worktree" form → `gitOps.worktreeAdd` → linked
`worktree` bubble; also used by the ticket), `worktreeModel.ts` (pure: branch / path / args / untracked
worktrees), `prSummary.ts`, `parts.tsx` (small sidebar widgets shared with ticket and deployment). The Renovate
count comes from `data.stats.renovatePrs`, kept current by the refresher. A project without an absolute
`baseDir` shows "Set the project's base checkout in Settings…" and the worktree actions open Settings instead.

### ticket

`kinds/ticket/`: own icon. *Change status…*: radio form → `jiraOps.transition`; the mock's invalid-transition
error is shown inline, then `refreshTicket` writes the new status back. *Create worktree*: the project's flow,
prefilled `<KEY>-<slug>`, sets `data.branch`, links `works on`. *Open in Jira*: `jiraUrl(key)`. *Mark done*
transitions to Done in Jira, stepping through the workflow if the direct move is rejected, else completes
locally with a warning toast. Sidebar Details: fields, ADF description via `adfToMarkdown` + `Markdown`, linked
issues, comments + add comment, related canvas items including PRs of the ticket's worktrees; Jira tab:
`WebPanel` with `partition="persist:jira"`.

### worktree

`kinds/worktree/`: `index.tsx`, `actions.tsx`, `Sidebar.tsx`, `model.ts` (pure, tested).

- **Create PR**: form (title from the ticket summary or branch, body with the ticket key and `jiraUrl` link,
  base branch, draft, *Stack on PR* = open PRs of the project, which replaces the base with that PR's
  `headBranch`). Submit = `gitOps.push(path, {setUpstream})` then `ghOps.prCreate`; a gh failure after the push
  says the branch was pushed. Then a `pr` item (`stackedOn` = parent item id) linked "from branch" to the
  worktree, "implements" to the ticket and "stacked on" to the parent PR. A known PR number is updated instead
  of duplicated.
- **Launch app / Run tests**: reuse the `app` / `testrun` item linked to the worktree (or with `worktreeId`),
  else create one (links "runs" / "tests"); runner id = item id; state then follows `sync/live.ts`.
- **Remove**: form with *Force* (shown when the checkout has changes). Agent sessions, apps and test runs whose
  cwd is inside the worktree are stopped first (`liveInWorktree`; Windows can't delete a folder a process
  runs in), then `gitOps.worktreeRemove(project.baseDir, path, {force})` (retried once if a handle lingers),
  then the bubble is archived without undo. Demo items are only archived (with undo).
- **Sidebar**: *Changes* (wide `DiffViewer`; "vs base" = merge base with `baseBranch`, "Uncommitted" = merge
  base with `HEAD`; untracked files are not in a diff) and *Stats* (git facts, changed files, diffstat vs
  base, commits since base, linked items).

### record

`kinds/record/`: `Sidebar.tsx`, `useRecordFile.ts`, `discovery.ts`, `model.ts`.

- **Sidebar**: live markdown of `data.path` (`fs.readText`; `fs:watch` on its folder); task checkboxes write
  back; *Edit* toggles a `CodeEditor` (Ctrl+S; a disk change while editing offers to load it). The step count
  follows the file.
- **Discovery** (`startRecordDiscovery()`, from `startSync`): per project with an absolute `baseDir`, lists
  `<baseDir>/records/**/*.md` (branch folders may contain `/`), watches the folder (re-scan debounced; a
  missing folder is checked every 30 s) and applies `planDiscovery`: record type from the file name prefix
  (plan / brainstorm / grill / verif), key = normalised path (no duplicates), `ticketBranch` = folder, linked
  to the ticket (`data.branch`, or the key) and to the worktree whose branch equals the folder (`/` may be
  flattened to `-`).

### pr

`kinds/pr/`: `logic.ts` (pure: ring, availability, merge args, stack helpers), `actions.tsx`, `builds.ts`
(checks → build items), `Sidebar.tsx`, `pr.css`.

- **Ring** mirrors `prPatch` / `summarizePr`: merged / closed alone; otherwise a review slice (draft wins, then
  approved / changes requested / pending) plus a conflict slice (`mergeable` CONFLICTING or
  `mergeStateStatus` DIRTY) and a checks slice. "No checks" counts as green for *mergeable*.
- **Merge…**: form with method (squash / merge / rebase), "delete branch", warnings for failing / running
  checks, missing approval, conflicts → `ghOps.prMerge`; the item is marked merged and archived (undo), stacked
  children are handled (below), and a toast offers to remove the PR's worktree.
- **Rebase**: `ghOps.prUpdateBranch(rebase)`; conflicts (known or reported) → warning + `/rebase @PR` in the
  chat box. **Request AI review…**: confirm showing the comment → `ghOps.requestAiReview`.
- **Stacked PRs** (`data.stackedOn` + the "stacked on" link): when the parent merged with "delete branch",
  GitHub retargets the children itself and their `baseBranch` is updated locally; otherwise the post-merge
  toast, a primary *Retarget onto <base>* action on the child and a button in its Stack section call
  `ghOps.prEdit({base})` (`gh pr edit --base`).
- **Sidebar**: *Overview* (state, author, base ← head, mergeable / mergeStateStatus, files, reviews, checks
  from `usePrChecks`, description, last comments, stack, connections; `usePr` results are written back with
  `prPatch`), *Files* (wide diff), *GitHub* (`WebPanel`, `partition="persist:github"`).
- **Builds from checks**: the Checks section keeps build bubbles of the PR in step (deduped by repo + name +
  PR number) and offers *Add N to canvas* for missing ones; the refresher keeps them current afterwards.

### build

`kinds/build/`: `logic.ts` (ring, Jenkins detection, rerun mode, `gh run view` → data), `Sidebar.tsx`.
*Re-run…* with a numeric `runId` (GitHub Actions): form with "only the failed jobs" → `ghOps.runRerun`, item
back to queued. Without one (Jenkins / other CI via the checks API) the details page opens. *Open in Jenkins*
when the URL looks like Jenkins, else *Open details*. Sidebar: state, conclusion, branch, PR, trigger,
duration, stage; for Actions runs the jobs from `useRun` (polls while running, failed jobs with their steps),
written back to the item; *Details* / *Jenkins* webview (`persist:ci`).

### testrun

`kinds/testrun/`: `logic.ts`, `failures.ts`, `Sidebar.tsx`. *Re-run*: `testOps.run({id: item.id, cwd,
command})`, item set to running right away; live sync sets state, summary, times, notices. *Stop* while
running. A failed run without failing tests (crash, exit code) still gets a red slice. Sidebar: counts,
command, directory, duration, worktree, failing tests parsed from the output (vitest, jest, pytest, go;
deduped) with *Fix with Claude*, and a live `LogView`.

### agent

`kinds/agent/`: `ring.ts`, `actions.tsx`, `session.tsx` (talking to main), `transcript.ts` (pure view model),
`Sidebar.tsx` + `agent.css` (the harness).

- **Actions**: one per option of the first open question (a single plain question answers directly;
  multi-question or multi-select opens the answer form), *Allow* / *Deny* per pending permission, *Interrupt*
  (running), *Stop*, *Send follow-up* (puts `@agent` into the chat box), *Continue* / *Fork* (AI), folder
  actions. Demo agents (no `localId`) keep local stop / answer.
- **Sidebar** (*Session* | *Details*): transcript from `useClaudeTranscript` through `buildRows()` (messages,
  thinking, tool calls with inputs and results, collapsible), the open AskUserQuestion as an inline card
  (radio / checkboxes, *Other…*, Submit → `claude:answer`), permission cards (Allow / Deny →
  `claude:permission`), composer (Enter sends, Shift+Enter new line, Esc interrupts), status line (status,
  model or "default model", permission mode when not default, context % bar, turns, cost, last activity).

### app

`kinds/app/`: `ops.ts` (start / stop / restart), `Sidebar.tsx` + `app.css`. Runner id = item id
(`apps:start {id, cwd, command}`), stored as `data.procId`; state via `app:state`. Ring: starting → running,
running → success, crashed → critical, stopped → neutral. Restart falls back to a fresh start when main no
longer knows the app. Sidebar: *Preview* (`WebPanel` on the detected URL, `persist:apps`, viewport switcher;
starting = spinner + last output, crashed = last log lines + Restart), *Log* (`LogView`, follow), *Details*.

### deployment

`kinds/deployment/`: stage chip via `badge` (dev neutral, staging primary, prod critical, custom pending).
*Edit…* (`form.ts`, also used by the project sidebar's *Add deployment*). Status is mocked
(`model.ts` `mockStatus`, deterministic per item id): the single place to replace with a real health check.

### todo

`kinds/todo/`: sidebar with an inline title, a markdown `CodeEditor` and a *Preview* toggle (task boxes toggle
the body); autosaves into the item (600 ms debounce, flushed on close). Adding from the canvas opens a small
form (title, notes, project) and opens the sidebar.

## Integrations

Real tools, called from main, never through a shell (except the user's own app / test command lines).

| | |
|---|---|
| `src/shared/integrations/*.ts` | dependency-free types the renderer may import: tool-shaped DTOs (gh JSON, Jira REST v3, Claude stream-json), pure parsers / mappers (`summarizePr`, `rollupChecks`, `summarizeIssue`, `adfToMarkdown`, `jiraBrowseUrl`, the Claude reducer `applyClaudeEvent`, `parseTestSummary`, `detectLocalUrl`), `DEFAULT_CONFIG` |
| `src/main/services/*.ts` | `GitService`, `GhService`, `JiraService`, `ClaudeSessions`, `AppRunner` / `TestRunner`; each takes an injectable `Runner` (tests) and throws `CliError` (`"<cmd> <subcommand>: <stderr>"`) |
| `src/main/ipc/integrations.ts` | the handlers; `src/shared/integrationSchemas.ts` the zod schemas |
| `src/preload/integrations.ts` | forwarding; `native.ts` has rejecting browser fallbacks |

Renderer: `native.git.status(dir)`, `native.gh.prView(repo, n)`, … and `native.on('claude:state', cb)` (typed,
returns unsubscribe; unknown channels throw). Request strings that end up as git / gh arguments (refs,
branches, remotes, labels) are rejected when they start with `-`, so they can't be read as options.

### git

`git` on PATH. All calls run with `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0` (never wait for an editor or a
password).

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
| `git:push` | `{dir, remote?, setUpstream?}` | `git push [-u] <remote or origin> HEAD` (before `gh pr create`) |

### GitHub

`gh` on PATH, logged in (`gh auth status`).

| Channel | Command |
|---|---|
| `gh:prList {repo, author?, app?, search?, state?, label?, head?, base?, limit?}` → `GhPrListItem[]` | `gh pr list --repo … --json GH_PR_LIST_FIELDS` |
| `gh:prView {repo, number}` → `GhPullRequest` | `gh pr view --json GH_PR_FIELDS` (incl. `statusCheckRollup`, `mergeable`, `mergeStateStatus`, `files`, `comments`, `latestReviews`) |
| `gh:prCreate {dir, title, body, base, head, draft?, repo?}` → `{number, url}` | `gh pr create` in `dir`; stacked PR = `base` is the parent PR's head branch. The head branch must be pushed already |
| `gh:prMerge {repo, number, method, deleteBranch?}` | `gh pr merge --merge\|--squash\|--rebase [--delete-branch]` |
| `gh:prComment {repo, number, body?}` → `{url?}` | `gh pr comment --body …`; without `body` the AI-review trigger (`config.github.aiReviewComment`, default `@claude review`) |
| `gh:prUpdateBranch {repo, number, rebase?}` → `{ok, message} \| {ok: false, conflicts, message}` | `gh pr update-branch --rebase` (conflicts → result, other failures throw) |
| `gh:prEdit {repo, number, base?, title?, body?}` | `gh pr edit [--base] [--title] [--body]` (at least one; used to retarget stacked PRs) |
| `gh:prDiff {repo, number}` → `string` | `gh pr diff --color never` |
| `gh:prChecks {repo, number}` → `GhCheck[]` | `gh pr checks --json GH_CHECK_FIELDS` (exit 8 = pending and 1 = failed still parse; "no checks reported" → `[]`) |
| `gh:runView {repo, runId}` → `GhRun` | `gh run view --json GH_RUN_FIELDS` (incl. jobs) |
| `gh:runRerun {repo, runId, failedOnly?}` | `gh run rerun [--failed]` |
| `gh:renovatePrs {repo}` → `GhPrListItem[]` | `gh pr list --app renovate` ∪ `--label renovate` |

Field lists live in `shared/integrations/github.ts` (verified against gh 2.102). Live read-only test:
`CORTEX_LIVE_GH=1 npx vitest run src/main/services/gh.test.ts`.

### Jira

`scripts/jira-mock` by default (Atlassian CLI surface).

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
`JIRA_MOCK_DB` (main passes `<userData>/jira-mock.json`), seeded with the demo's CTX tickets.

Main runs it as `<process.execPath> <app>/scripts/jira-mock/jira-mock.mjs` with `ELECTRON_RUN_AS_NODE=1`
(no node on PATH needed). `exec:run` with `cmd: 'jira-mock'` maps to the same command. A packaged build
must ship `scripts/jira-mock/` unpacked next to the app (packaging is not set up yet).

**Swapping in the real Atlassian CLI:** install `acli`, `acli jira auth login`, then start Cortex with
`CORTEX_JIRA_CLI=acli`. `JiraService` sends the same arguments to `acli`. Things to check then: the custom
field ids (`JIRA_FIELDS` in `shared/integrations/jira.ts`), the workflow's status names, and the shape of
`search --json` (the service accepts an array or `{issues: […]}`). Browse links follow the issues' `self` URL.

### Claude Code

`claude` on PATH. One long-lived process per session:
`claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio
--session-id <uuid> | --resume <id> [--model] [--effort] [--permission-mode] [--add-dir …] [--append-system-prompt]`
(flags checked against Claude Code 2.1.323, permission modes against 2.1.325). User messages go to stdin as `{type: 'user', message}` lines;
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
| events `claude:event {localId, event}`, `claude:state ClaudeSessionSummary` | status `starting · running · waiting · idle · done · failed`, `model`, `permissionMode`, `pendingQuestion`, `pendingPermissions`, `activity`, `lastText`, `usage` (tokens, context, cost, turns) |

**AskUserQuestion.** With `--permission-prompt-tool stdio` the CLI asks the host before it runs a tool:
a stdout line `{type: 'control_request', request_id, request: {subtype: 'can_use_tool', tool_name,
input, tool_use_id}}`. For `AskUserQuestion` the manager parks that request by `tool_use_id`; `answer()`
replies `{type: 'control_response', response: {subtype: 'success', request_id, response: {behavior:
'allow', updatedInput: {...input, answers: {"<question>": "<label>"}}}}}` (multi-select joined with
", "). The CLI then runs the tool with those answers and emits its `tool_result` itself, exactly as with the
Agent SDK's `canUseTool`. The protocol was read from the installed CLI's own schemas; it is exercised
end-to-end with the fake CLI (`src/main/services/__fixtures__/fake-claude.mjs`), not a paid session. Fallback
when no request was parked for that tool use: the answers are sent as the next user message. A typed `send()`
while a question is open denies the question first. Other tools' prompts appear in `pendingPermissions`
(depends on `--permission-mode`; `acceptEdits` / `bypassPermissions` reduce them). Other host requests (hooks,
MCP, elicitation) are answered with an error response so the CLI never hangs.

Permission modes (the Settings select): CLI default (no flag), `manual`, `acceptEdits`, `plan`, `auto`,
`dontAsk`, `bypassPermissions`. Cost: `total_cost_usd` is cumulative per process, so each result adds its
delta. Session metadata (`localId`, Claude `session_id`, cwd, title, model, permission mode, cost) is stored in
`<userData>/claude-sessions.json`. Binary: `CORTEX_CLAUDE_BIN`; a `.js` / `.mjs` path runs with Electron's
node, e.g. `CORTEX_CLAUDE_BIN=src/main/services/__fixtures__/fake-claude.mjs` for a free end-to-end run.

### Apps and test runs

The user's command line, through the shell.

| Channel | Notes |
|---|---|
| `apps:start {id, cwd, command, env?, urlHint?}` → `AppState` | `starting` → `running` once a local URL is printed (`http://localhost:N`, `127.0.0.1`, `0.0.0.0`/`[::]` → localhost) or after 8 s alive; `exited` (stopped / exit 0) or `crashed` |
| `apps:stop` / `apps:restart` / `apps:list` / `apps:log` / `apps:remove` | `log` = last 256 KB |
| `tests:run {id, cwd, command, env?}` → `TestState` | `running` → `passed` / `failed` / `error` (stopped, spawn failure) with `summary` (vitest, jest, pytest, go test, mocha, TAP / `node --test`; best effort) |
| `tests:stop` / `tests:list` / `tests:log` | |
| events `app:state`, `app:output`, `test:state`, `test:output` | output batched per id + stream every 100 ms and flushed before the exit / state |

### Config knobs

Env, read once at start (`src/main/services/config.ts`): `CORTEX_JIRA_CLI=mock|acli`,
`CORTEX_JIRA_MOCK_SCRIPT`, `JIRA_MOCK_DB`, `JIRA_MOCK_SITE`, `CORTEX_CLAUDE_BIN`, `CORTEX_AI_REVIEW_COMMENT`,
`CORTEX_RENOVATE_APP`. Defaults in `shared/integrations/config.ts`; `integrations:config` returns the effective
values (Settings shows the Jira mode).

## Smoke runs

`CORTEX_SMOKE=1 npm run dev` (or `npx electron-vite preview` for the build) loads the app, runs a probe from
inside the page and quits. Main opens the page as `index.html#smoke`, which exposes `window.__cortexDebug`
(`debug.ts`: store access, `runAction(id, actionId)`, `forms` = `formDriver`, `sendPrompt`, `chooseOption`,
`openAdd`, `replaceWorld`, `refreshDue`, `showGallery`). Use a throw-away profile (`CORTEX_USER_DATA=<tmp>`).

| Variable | What it adds |
|---|---|
| (none) | bridge calls (app info, workspace, exec allowlist, git / jira-mock / claude list, a test run) |
| `CORTEX_SMOKE_SHOT=<png>` | a screenshot at the end |
| `CORTEX_SMOKE_GH_REPO=owner/name` | a read-only `gh pr list` |
| `CORTEX_SMOKE_E2E=1` | a project on this repo + forced refresh; with `CORTEX_CLAUDE_BIN=<fake-claude.mjs>` chat → agent → question → answer and the agent harness via the DOM; an app with a tiny HTTP server (URL, preview, restart, stop, crash). `CORTEX_SMOKE_FINAL=app \| agent \| <item id>` picks the final view |
| `CORTEX_SMOKE_GALLERY=1` | the viewer gallery: mermaid, CodeMirror, diff rendering and CSP violations |
| `CORTEX_SMOKE_REPO=1` | the real-repo click-through (`smokeRepo.ts`): a temp repo with a local bare `origin`, then project via Add, new worktree, launch app, run tests, commit → diff, record file → record bubble, todo add / edit, create PR up to the push, Jira status change, agent question (fake CLI), settings, worktree removal. Checklist on stdout, screenshots in `CORTEX_SMOKE_OUT` (default `<tmp>/cortex-smoke-*`). Start it with `GH_HOST=smoke.invalid` so gh never contacts GitHub |

## Where things live

| | |
|---|---|
| Workspace file | `<userData>/workspace.json` (+ `.bak`); Windows `%APPDATA%\cortex` |
| Window state | `<userData>/window-state.json` |
| Jira mock data | `<userData>/jira-mock.json` (seeded on first use) |
| Claude session metadata | `<userData>/claude-sessions.json` |
| Build output | `out/main`, `out/preload/index.cjs`, `out/renderer` |
| Static assets | `public/` (renderer `publicDir`); reference them with `asset('brand/…')` from `native.ts`, not `/brand/…`, so they resolve under `file://` too |
| Separate profile | `CORTEX_USER_DATA=<dir>` |
