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
| `exec:run` | `{cmd, args, cwd, env?, timeoutMs?, stdin?}` → `{code, stdout, stderr, timedOut}` | `cmd` ∈ `git gh claude node jira-mock`; no shell; tree-killed on timeout (default 120 s) |
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
which returns an unsubscribe function.

### Adding a channel

1. Add it to `InvokeChannels` (and `CortexApi`) in `src/shared/ipc.ts`.
2. Add its request schema to `schemas` in `src/shared/schemas.ts` (typecheck fails until it matches).
3. Register a handler with `handle(ctx, 'group:name', fn)` in `src/main/ipc/*`.
4. Forward it in `src/preload/index.ts` and add a fallback in `src/renderer/src/native.ts`.

## Renderer

```
src/renderer/src/
  domain/      pure model: zod schemas (source of truth), inferred types, migrations, graph helpers
  kinds/       kind registry: registry.ts, types.ts (KindModule), common.tsx (shared actions + helpers),
               icons.tsx, and one folder per kind: project ticket worktree record pr agent app build
               deployment todo testrun
  sidebar/     sidebar building blocks (SidebarSection, SummarySection, FactsSection, ConnectionsSection,
               DefaultSidebar); overlays/Sidebar.tsx is the shell
  data/        TanStack Query: queryClient.ts, queryKeys.ts, one file of hooks per integration
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
| agent | `sessionId?`, `cwd`, `model?`, `status` (running / waiting / idle / done / failed), `skill?`, `pendingQuestion? {toolUseId, questions[{question, header?, options[{label, description?}], multiSelect?}]}`, `lastActivity?`, `startedAt?`, `endedAt?`, `usage? {contextPct, costUsd, turns}` |
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

`ctx` (`KindCtx`, cached per items/links change): `items`, `links`, `get(id)`, `getAs(id, kind)`,
`linked(id, kind?)`, `inProject(projectId, kind?)`, `projectOf(item)`, `kind(k)`.

Registry helpers (`kinds/registry.ts`): `getKind`, `kindIcon`, `kindLabel`, `levelOf`, `radiusOf`,
`ctxOf` / `useCtx`, `viewsOf` / `useViews` (per-item `{ring, short, badge, subtitle, waiting, running}`,
cached), `factsOf`, `sidebarOf`, `actionsForItem` (kind actions + *Mark done* + *Archive*; archived items
get *Unarchive* + view / external actions only).

Action building blocks (`kinds/common.tsx`): `skill(id, label, skillName)` inserts `/skill @item` into the
chat box (AI actions), `external(id, label, url)` (mock toast until wired), `placeholder(id, label, icon)`
("not implemented yet" toast), `toast`, `archive`, and the shared `completeAction`, `archiveAction`,
`unarchiveAction`, `removeAction`.

#### How to add a kind

1. `domain/schemas.ts`: add the name to `KINDS`, a `<Kind>DataSchema`, an entry in `ItemSchemas` and in
   `ItemSchema`. A new kind needs no migration; an incompatible change to an existing data shape does
   (bump `WORKSPACE_VERSION`, see below).
2. `domain/types.ts`: export the data type (optional).
3. `kinds/<kind>/index.tsx`: export a `KindModule<'<kind>'>`. Build actions inside `actions()`; import only
   from `domain`, `store`, `layout`, `native`, `data`, `tones`, `kinds/common`, `kinds/icons`, `sidebar`.
4. `kinds/registry.ts`: add it to `MODULES` (typecheck fails until every kind has a module).
5. Add a seed example and run `npm test` (the registry test checks every kind and every seed item).

#### Per-kind work (phase 3)

Each kind's actions and sidebar live entirely in `kinds/<kind>/` (add files there: `Sidebar.tsx`,
`actions.tsx`, hooks). Compose sidebars from the `sidebar/` sections. Shared hot spots, change only with
care and in small, separate commits: `domain/schemas.ts` (data shapes), `kinds/types.ts`,
`kinds/registry.ts`, `kinds/common.tsx`, `kinds/icons.tsx`, `store.ts`, `sidebar/index.tsx`,
`data/queryKeys.ts`, `seed.ts`, `index.css`.

### Store

zustand (`create` + `subscribeWithSelector`) in `store.ts`; components read with `useStore(selector)`
(selectors must return stable values: cache derived ones, like `visibleSet`, `viewsOf` and `ctxOf` do).
Everything else uses the exported functions. Positions stay in `layout.ts`; only dropped positions are
written to the items (`pos`) on drag end.

### Workspace file and migrations

`<userData>/workspace.json`:

```jsonc
{
  "version": 1,
  "items": [ /* Item */ ],
  "links": [ { "id": "l1", "from": "t-4821", "to": "p-ingest", "label": "in project" } ],
  "prefs": { "desktopNotify": false, "soundOn": true, "colorBy": "project", "filter": { /* Filter */ } },
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

Adding a version: bump `WORKSPACE_VERSION`, add `MIGRATIONS[old]`, a fixture of the old format and a test.
Never edit an existing step.

## Remote data (TanStack Query)

Live data from integrations is read with TanStack Query; the `QueryClient` (`data/queryClient.ts`) is
provided in `main.tsx`. Pattern:

- **Keys** only from the factory in `data/queryKeys.ts`: `[integration, resource, ...params]`
  (`qk.gh.pr(repo, n)`), so invalidation can target an integration (`qk.gh.all`), a resource or one entity.
- **One file of hooks per integration** in `data/` (`data/gh.ts`, `data/git.ts`, …), each hook wrapping a
  `native.*` call: `useQuery({ queryKey: qk.git.status(path), queryFn: () => … })`. Example:
  `data/app.ts` → `useAppInfo()` (shown in the notifications menu).
- **Invalidate after actions**: an action that changes something remote calls
  `queryClient.invalidateQueries({ queryKey: … })` when it is done.
- **Poll running things** with `refetchInterval` (a running build, agent or test run), e.g.
  `refetchInterval: (q) => (q.state.data?.state === 'running' ? 5_000 : false)`.
- **Write back what the ring needs**: when a query result changes a cached field (PR checks, git stats),
  `patchData()` the item so the canvas (and the next start) shows it; everything else stays in the cache.
- Defaults: `staleTime` 30 s, no refetch on window focus, one retry.

## Where things live

| | |
|---|---|
| Workspace file | `<userData>/workspace.json` (+ `.bak`); Windows `%APPDATA%\cortex` |
| Window state | `<userData>/window-state.json` |
| Build output | `out/main`, `out/preload/index.cjs`, `out/renderer` |
| Static assets | `public/` (renderer `publicDir`); reference them with `asset('brand/…')` from `native.ts`, not `/brand/…`, so they resolve under `file://` too |
| Separate profile | `CORTEX_USER_DATA=<dir>` |
| Headless bridge check | `CORTEX_SMOKE=1 npm run dev` (`src/main/smoke.ts`); `CORTEX_SMOKE_SHOT=<file.png>` also saves a screenshot |
