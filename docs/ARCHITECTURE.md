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

## Renderer

```
src/renderer/src/
  domain/      pure model: zod schemas (source of truth), inferred types, migrations, graph helpers
  kinds/       kind registry: registry.ts, types.ts (KindModule), common.tsx (shared actions + helpers),
               icons.tsx, and one folder per kind: project ticket worktree record pr agent app build
               deployment todo testrun
  sidebar/     sidebar building blocks (SidebarSection, SummarySection, FactsSection, ConnectionsSection,
               DefaultSidebar); overlays/Sidebar.tsx is the shell
  data/        TanStack Query: queryClient.ts, queryKeys.ts, ops.ts, one file of hooks + write ops per integration
  sync/        live events → items (live.ts), startup reconciliation, background refresher, pure mappings
  ui/          toolkit for kind modules: form.tsx (openForm), formModel.ts, task.tsx (runTask, openUrl, …)
  chat/        ChatBox.tsx, prompt.ts (prompt / context expansion, cwd resolution)
  store.ts     zustand store + the function API (select, patchItem, patchData, notify, insertSkill, …)
  persist.ts   workspace load (migrate + validate) and debounced autosave
  layout.ts    d3-force simulation; positions live here, not in the store
  actions.tsx  selection-level actions, chat send
  visual.ts    group colours; tones.ts: tone → colour maps, "x min ago"
  canvas/ overlays/ chat/   UI; they reach kinds only through kinds/registry.ts
```

Import direction (keep it acyclic): `domain` ← `store` ← `kinds/common`, `sidebar` ← `kinds/<kind>` ←
`kinds/registry` ← UI. The store and `layout.ts` never import the registry: what the store needs to know
about kinds (ring tones and search text for the filter, hierarchy levels) is handed to it with
`provideKindInfo()` when `kinds/registry.ts` is imported (`main.tsx` does that first; tests that use the
filter import it too). Kind modules must not import `kinds/registry` or `visual.ts`; to reach another kind
use `ctx.kind(k)`.

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
| pr | `repo`, `number`, `headBranch`, `baseBranch`, `state` (open / closed / merged), `isDraft`, `author?`, `reviewDecision?`, `reviews? {approved, requested}`, `mergeable?`, `checks? {state, passed?, failed?, pending?}`, `additions?`, `deletions?`, `stackedOn?` (PR item id) |
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
| `addable?` `{label, hint, multiline?, detect?(input), create(input, project)}` | canvas *Add* menu, add dialog, paste detection |

`addable.open?(at)` replaces the add dialog with a custom flow (project → settings form, agent → chat box).

`ctx` (`KindCtx`, cached per items/links change): `items`, `links`, `get(id)`, `getAs(id, kind)`,
`linked(id, kind?)`, `inProject(projectId, kind?)`, `projectOf(item)`, `kind(k)`.

Registry helpers (`kinds/registry.ts`): `getKind`, `kindIcon`, `kindLabel`, `levelOf`, `radiusOf`,
`ctxOf` / `useCtx`, `viewsOf` / `useViews` (per-item `{ring, short, badge, subtitle, waiting, running}`,
cached), `factsOf`, `sidebarOf`, `actionsForItem` (kind actions + *Mark done* + *Archive*; archived items
get *Unarchive* + view / external actions only).

Action building blocks (`kinds/common.tsx`): `skill(id, label, skillName)` inserts `/skill @item` into the
chat box (AI actions), `external(id, label, url)` (opens in the OS browser), `openPathAction` / `openInEditorAction`
(folder in the OS / in `code`), `placeholder(id, label, icon)`
("not implemented yet" toast), `toast`, `archive`, and the shared `completeAction`, `archiveAction`,
`unarchiveAction`, `removeAction`.

#### How to add a kind

1. `domain/schemas.ts`: add the name to `KINDS`, a `<Kind>DataSchema`, an entry in `ItemSchemas` and in
   `ItemSchema`. A new kind needs no migration; an incompatible change to an existing data shape does
   (bump `WORKSPACE_VERSION`, see below).
2. `domain/types.ts`: export the data type (optional).
3. `kinds/<kind>/index.tsx`: export a `KindModule<'<kind>'>`. Build actions inside `actions()`; import only
   from `domain`, `store`, `layout`, `native`, `data`, `ui`, `tones`, `kinds/common`, `kinds/icons`, `sidebar`.
4. `kinds/registry.ts`: add it to `MODULES` (typecheck fails until every kind has a module).
5. Add a seed example and run `npm test` (the registry test checks every kind and every seed item).

#### Per-kind work (phase 3)

Each kind's actions and sidebar live entirely in `kinds/<kind>/` (add files there: `Sidebar.tsx`,
`actions.tsx`, hooks). Compose sidebars from the `sidebar/` sections and use the [toolkit](#toolkit-for-kind-modules-phase-3) (forms, `runTask`, data ops). Shared hot spots, change only with
care and in small, separate commits: `domain/schemas.ts` (data shapes), `kinds/types.ts`,
`kinds/registry.ts`, `kinds/common.tsx`, `kinds/icons.tsx`, `store.ts`, `sidebar/index.tsx`,
`data/queryKeys.ts`, `data/ops.ts`, `ui/*`, `sync/*`, `seed.ts`, `index.css`.

### Store

zustand (`create` + `subscribeWithSelector`) in `store.ts`; components read with `useStore(selector)`
(selectors must return stable values: cache derived ones, like `visibleSet`, `viewsOf` and `ctxOf` do).
Everything else uses the exported functions. Positions stay in `layout.ts`; only dropped positions are
written to the items (`pos`) on drag end.

### Workspace file and migrations

`<userData>/workspace.json`:

```jsonc
{
  "version": 2,
  "items": [ /* Item */ ],
  "links": [ { "id": "l1", "from": "t-4821", "to": "p-ingest", "label": "in project" } ],
  "prefs": {
    "desktopNotify": false, "soundOn": true, "colorBy": "project", "filter": { /* Filter */ },
    // v2: store.settings (setSettings); a bad value falls back to its default
    "model": "claude-…",            // optional; unset = the Claude CLI's default
    "permissionMode": "default",    // claude --permission-mode for new sessions
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

v0 (phase 0a): `{version: 0, items, links}` with display-only items (`status`, `facts`, `subtitle`,
`flags`, `cluster`, `notice.ago`); prefs in localStorage. v0 → v1 parses those strings into typed `data`,
`plan` → `record`, `cluster` → `projectId`, `notice.ago` → `notice.at`, and carries the localStorage prefs
over. Fixture: `domain/fixtures/workspace-v0.json`.

v1 → v2 (phase 2b): adds the settings prefs above with their defaults; agent data gains the optional
`localId` (the session id in main), `pendingPermissions` and `error`. Fixture: `domain/fixtures/workspace-v1.json`.

Adding a version: bump `WORKSPACE_VERSION`, add `MIGRATIONS[old]`, a fixture of the old format and a test.
Never edit an existing step.

## Remote data (TanStack Query)

Live data from integrations is read with TanStack Query; the `QueryClient` (`data/queryClient.ts`) is
provided in `main.tsx`. Pattern:

- **Keys** only from the factory in `data/queryKeys.ts`: `[integration, resource, ...params]`
  (`qk.gh.pr(repo, n)`), so invalidation can target an integration (`qk.gh.all`), a resource or one entity.
- **One file of hooks per integration** in `data/` (`data/gh.ts`, `data/git.ts`, …), each hook wrapping a
  `native.*` call: `useQuery({ queryKey: qk.git.status(path), queryFn: () => … })`. Hooks take possibly-undefined
  params and only run in the desktop app with every param set (`ready()` in `data/ops.ts`). The list is below.
- **Invalidate after actions**: an action that changes something remote calls
  `queryClient.invalidateQueries({ queryKey: … })` when it is done.
- **Poll running things** with `refetchInterval` (a running build, agent or test run), e.g.
  `refetchInterval: (q) => (q.state.data?.state === 'running' ? 5_000 : false)`.
- **Write back what the ring needs**: when a query result changes a cached field (PR checks, git stats),
  `patchData()` the item so the canvas (and the next start) shows it; everything else stays in the cache.
- Defaults: `staleTime` 30 s, no refetch on window focus, one retry.

### Data hooks and write ops (phase 2b)

Reads are hooks; writes are plain async functions in a `<service>Ops` object (kind actions run outside
React) that invalidate what they change. In a component, `useOp(ghOps.prMerge)` gives a mutation
(`m.mutate([repo, n, 'squash'])`, `m.isPending`, `m.error`).

| file | hooks | ops |
|---|---|---|
| `data/git.ts` | `useGitStatus(dir)`, `useGitDiff(dir, base?)`, `useGitDiffStat(dir, base?)`, `useGitLog(dir, {range, limit})`, `useCurrentBranch(dir)`, `useRemoteRepo(dir)`, `useWorktrees(repoDir)` | `gitOps.worktreeAdd(repoDir, path, branch, base?, {newBranch})`, `worktreeRemove(repoDir, path, {force})`, `fetch(dir)`, `rebase(dir, onto)`, `rebaseAbort(dir)`, `detect(dir)` → `{repo, branch}` \| null |
| `data/gh.ts` | `usePr(repo, n)`, `usePrSummary(repo, n)`, `usePrDiff(repo, n)`, `usePrChecks(repo, n)` (polls while pending), `usePrList(repo, filter)`, `useRenovatePrs(repo)`, `useRun(repo, runId)` (polls until completed) | `ghOps.prCreate(req)`, `prMerge(repo, n, method, {deleteBranch})`, `prComment(repo, n, body)`, `requestAiReview(repo, n)` (uses the `aiReviewComment` setting), `prUpdateBranch(repo, n, {rebase})`, `runRerun(repo, runId, {failedOnly})` |
| `data/jira.ts` | `useJiraIssue(key)`, `useJiraIssueSummary(key)`, `useJiraSearch(jql, limit?)` | `jiraOps.transition(key, status)`, `create(req)`, `comment(key, body)`, `edit(req)` |
| `data/claude.ts` | `useClaudeSessions()`, `useClaudeSession(localId)` (messages, status, usage), `useClaudeTranscript(localId)` (raw events, appended live) | `claudeOps.start(req)`, `send(localId, text)`, `answer(localId, toolUseId, answers)`, `permission(localId, requestId, decision)`, `interrupt`, `stop`, `remove` |
| `data/apps.ts` | `useApps()`, `useAppLog(id)` (appended live) | `appOps.start(req)`, `stop(id)`, `restart(id)`, `remove(id)` |
| `data/tests.ts` | `useTestRuns()`, `useTestLog(id)` (appended live) | `testOps.run(req)`, `stop(id)` |
| `data/app.ts` | `useAppInfo()`, `useIntegrationConfig()` | |

Keys (`data/queryKeys.ts`) nest so prefixes invalidate groups: `qk.gh.pr(repo, n)` covers its diff and checks,
`qk.gh.prs(repo)` every PR list, `qk.git.dir(dir)` status / diff / log of one checkout, `qk.jira.searches()`
every search, `qk.claude.session(id)` its transcript.

Ids: an agent's session id in main is `data.localId` (the chat box uses the item id); apps and test runs use the
item id as runner id and store it as `data.procId`. Live sync matches events by these.

### Live sync, reconciliation, background refresh (`sync/`)

`startSync()` (main.tsx, desktop only):

- **Live events** (`sync/live.ts`): `claude:state` → the agent with that `localId` (status, `pendingQuestion`,
  `pendingPermissions`, activity, usage, error); `app:state` / `test:state` → the app / test run with that `procId`
  (state, url / port; state, summary, `outputTail`). Mappings are pure (`sync/mapping.ts`). Notices on
  transitions: agent asks / needs permission → warning, agent finished → success, agent failed / app crashed /
  tests failed → critical, tests passed → success. `claude:event` / `app:output` / `test:output` are appended to
  the transcript / log caches; the session query is refetched (debounced) on state changes.
  Agent status mapping: claude `idle` (turn done, process alive) → `done`, interrupted → `idle`; process gone
  mid-turn → `idle`.
- **Reconcile** at start: items that were really started (`localId` / `procId`) and say they run, but main does
  not know them (the app restarted), become idle / stopped; known ones take main's state, without notices.
  Demo items (no ids) are left alone.
- **Refresher** (`sync/refresher.ts`): every `settings.refreshSec` (default 60 s; 15 s for open PRs with pending
  checks), only while the window is visible: worktree → `git status` + ahead / behind `origin/<base>`; open PR →
  `gh pr view` (state, review, mergeable, checks with counts); ticket → `jira view` (status, category, assignee,
  sprint, points, title); project → open / Renovate PR counts. Results also seed the query caches; unchanged
  values don't touch the store. Non-absolute paths (`~/…` demo data) are skipped; failures log once and back off
  exponentially per item and per gh repo (up to 30 intervals).

### Chat box → Claude Code

`sendPrompt(text, mentionedIds)` (`actions.tsx`, logic in `chat/prompt.ts`):

1. Exactly one mentioned agent with a session (`localId`) → `claude:send` to it (follow-up).
2. Otherwise a new session: cwd = `resolveCwd(mentions)`: a mentioned worktree > a worktree linked to (or with the
   ticket key of) a mention > a mentioned app / test run / agent dir > the project's `baseDir`; absolute paths only.
   None → a small form: pick a configured project or any folder (native picker).
3. Prompt = `buildPrompt`: the draft as typed (a leading `/skill` stays the slash command) + a context block, one
   line per mention, e.g. `- @CTX-4821 = Jira ticket CTX-4821 "Retry …" (In Progress, Story, branch feat/…)`.
4. An agent item is created (`localId` = item id, linked `about` the mentions and `belongs to` the project), then
   `claude:start {localId, cwd, prompt, title, model, permissionMode}` with `settings.model` (unset = CLI default)
   and `settings.permissionMode` (`default`). The draft clears once sent; a toast offers *Open*.

Agent actions (`kinds/agent/session.tsx`): one per option of the first open question (a single plain question
answers right away via `claude:answer`; several questions or multi-select open a form with all of them), *Allow* /
*Deny* per pending tool permission (`claude:permission`), *Interrupt*, *Stop*, *Follow up* (puts `@agent` into the
chat box). Demo agents keep local mock behaviour.

## Toolkit for kind modules (phase 3)

Everything a kind module needs besides `data/*`:

```ts
// ui/form.tsx: a modal form, rendered by <FormHost/> (mounted once); stacks over other dialogs
openForm({
  title: string, description?: string, submitLabel?: string, danger?: boolean,
  fields: { name, label, type: 'text'|'textarea'|'select'|'checkbox'|'directory'|'file'|'radio',
            options?: (string | {value, label, hint?})[], required?, default?, hint?, placeholder?,
            validate?: (value, values) => string | undefined, when?: (values) => boolean,
            filters?: {name, extensions}[] /* file */, rows? /* textarea */ }[],
  values?: Partial<FormValues>,                         // initial values
  onChange?: (name, values) => Partial<FormValues> | void | Promise<…>,   // derived fields
  onSubmit: (values: FormValues) => void | Promise<void>,  // throw → error shown, dialog stays open
}): Promise<FormValues | null>                          // null = cancelled
// FormValues = Record<string, string | boolean>; str(values, name) reads a string.
// directory / file fields have a "Browse…" button (native pickers). Validation runs on submit, then live.

// ui/task.tsx
runTask(label, promiseOrFn, { success?, message?, quiet? }): Promise<T | undefined>  // spinner toast → success / critical
errorText(e)                // readable message of a failed native call
openUrl(url) / openPath(path) / openInEditor(path)   // report failures as a toast instead of throwing

// kinds/common.tsx (action builders)
skill(id, label, skillName, extra?) · external(id, label, (item) => url, extra?)
openPathAction(id, label, (item) => path, extra?) · openInEditorAction(id, label, (item) => path, extra?)
placeholder(id, label, icon) · toast(title, message?, type?) · archive(items)

// sidebar/index.tsx
<SidebarTabs rememberAs="pr" initial="details" tabs={[{ id, label, render: () => node, wide?: boolean, badge? }]} />
useSidebarLayout() → { wide, setWide(boolean), width }   // a webview / diff tab can go wide
SidebarSection, SummarySection, FactsSection, ConnectionsSection, DefaultSidebar

// kinds/project: openProjectSettings(project?, at?) → the project's real paths / commands
// store: settings (model, permissionMode, aiReviewComment, refreshSec, sidebarWidth), setSettings(patch)
```

The sidebar shell (`overlays/Sidebar.tsx`) is resizable (drag the left edge; persisted as `settings.sidebarWidth`)
and has an expand button (about 60 % of the window); a tab with `wide: true` expands it while active.

## Where things live

| | |
|---|---|
| Workspace file | `<userData>/workspace.json` (+ `.bak`); Windows `%APPDATA%\cortex` |
| Window state | `<userData>/window-state.json` |
| Build output | `out/main`, `out/preload/index.cjs`, `out/renderer` |
| Static assets | `public/` (renderer `publicDir`); reference them with `asset('brand/…')` from `native.ts`, not `/brand/…`, so they resolve under `file://` too |
| Separate profile | `CORTEX_USER_DATA=<dir>` |
| Headless bridge check | `CORTEX_SMOKE=1 npm run dev` (`src/main/smoke.ts`); `CORTEX_SMOKE_SHOT=<file.png>` also saves a screenshot; `CORTEX_SMOKE_GH_REPO=owner/name` adds a read-only `gh pr list`; `CORTEX_SMOKE_E2E=1` (dev only, via `window.__cortexDebug` from `debug.ts`) adds a project on this repo + a forced refresh, and chat → agent → question → answer when `CORTEX_CLAUDE_BIN` is the fake CLI |
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
`<userData>/claude-sessions.json`. Binary: `CORTEX_CLAUDE_BIN` (tests inject `node <fake script>`); a `.js` / `.mjs` path runs with Electron's node,
e.g. `CORTEX_CLAUDE_BIN=src/main/services/__fixtures__/fake-claude.mjs` for a free end-to-end run.

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

### Kind: agent

`kinds/agent/`: `index.tsx` (module), `ring.ts`, `actions.tsx`, `session.tsx` (talking to main), `transcript.ts`
(pure view model, tested), `Sidebar.tsx` + `agent.css` (the harness).

- **Actions** (`agentActions`): *View session* / *Answer in session* (opens the sidebar), one action per option of
  the first open question (a single plain question answers directly; multi-question or multi-select opens the
  answer form preset with that option, and adds *Answer…*), *Allow* / *Deny* per pending permission, *Interrupt*
  (running), *Stop* (running / waiting), *Send follow-up* (puts `@agent` into the chat box; disabled while a
  question is open), *Continue* / *Fork* (AI skills), *Open folder in editor* / *Show folder* (absolute cwd only).
  Demo agents (no `localId`) keep *Resume* and local stop / answer.
- **Sidebar** (tabs *Session* | *Details*): transcript from `useClaudeTranscript` replayed through
  `buildRows()` — the shared reducer's messages plus what it drops (thinking blocks, tool inputs); user / assistant
  messages (assistant via `Markdown`), consecutive tool calls in one box, each row collapsible (input — Edit as
  `-`/`+` lines — and result), thinking collapsed. The open AskUserQuestion is an inline card (radio or
  multi-select checkboxes, *Other…* free text, Submit → `claude:answer`); answered ones collapse to a summary.
  Permission cards (tool, summary, reason, Allow / Deny → `claude:permission`) from `useClaudeSession`
  (falls back to the item's cached `pendingPermissions`). Composer: Enter sends (`claudeOps.send`), Shift+Enter
  new line, Esc interrupts while running; Interrupt / Stop buttons. Status line: status chip, model, context %
  bar (warning ≥ 80 %, critical ≥ 95 %), turns, cost, last activity. The harness fills the sidebar body (its CSS
  makes `.sidebar-body` / `.sidebar-tabpanel` flex columns via `:has(.ah)`), so the transcript scrolls and the
  composer stays at the bottom; it works narrow and wide. Demo agents: an empty state plus their seeded question card.
- The prototype session dialog (`overlays/Dialogs.tsx` → `SessionSheet`) is no longer opened by anything.

### Kind: app

`kinds/app/`: `index.tsx` (module, `appActions`), `ops.ts` (start / stop / restart, tested helpers),
`Sidebar.tsx` + `app.css`.

- **Runner id** = the item id (`apps:start {id: item.id, cwd, command}`), stored as `data.procId`; state comes back
  through `app:state` (sync/live.ts). Ring: starting → running tone, running → success, crashed → critical,
  stopped → neutral.
- **Actions**: *Open in browser* (the detected URL; primary when running), *Preview*, *Restart* + *Stop* while
  live, *Start* when stopped (*Restart* when crashed), *Show log* (opens the Log tab; primary when crashed),
  *Open folder in editor*. A missing / non-absolute cwd (demo data) disables start with the "Set the project's base
  checkout in Settings…" hint; demo items stop locally. Restart falls back to a fresh start when main no longer
  knows the app (Cortex restarted). Start / restart have no progress toast (spawning returns at once); failures
  toast and revert the optimistic `starting`.
- **Sidebar** (tabs *Preview* | *Log* | *Details*): Preview = `WebPanel` on the URL (`partition="persist:apps"`,
  viewport switcher, reload, open externally; the tab goes wide only while it shows the webview); starting =
  spinner + the last output lines + Cancel; running without a URL = hint + Stop; crashed = the last 20 log lines,
  Restart, *Show full log*; stopped = command / cwd + Start. Log = `LogView` of `useAppLog` (follow).
  `showAppTab('log' | 'preview')` switches the tab from actions.

Verified with `CORTEX_SMOKE=1 CORTEX_SMOKE_E2E=1 CORTEX_CLAUDE_BIN=<abs>/src/main/services/__fixtures__/fake-claude.mjs
npm run dev` (see `src/main/smoke.ts`): agent harness via the DOM (permission → allow, follow-up from the composer,
question card → submit, Esc interrupt) and an app running a tiny `node -e` HTTP server (URL detected, webview,
restart frees the old port / pid, stop frees port and pid, a crashing command shows the crash state).
`CORTEX_SMOKE_FINAL=app | agent | <item id>` picks what `CORTEX_SMOKE_SHOT` captures.
