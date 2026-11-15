# Cortex production-readiness audit

*2026-11-15 · branch `app` at `c6bcba3` · read-only review*

Paths are relative to the repo root; `R/` stands for `src/renderer/src/`. A finding marked **✔** was
re-checked by hand against the code; the rest come from the exploring agents and carry their file:line
references (line numbers may be off by a few).

## Contents

1. [Verdict](#1-verdict)
2. [Extensibility](#2-extensibility)
3. [Configuration](#3-configuration)
4. [Error handling and robustness](#4-error-handling-and-robustness-main-process)
5. [Security](#5-security)
6. [Performance](#6-performance-renderer)
7. [UX / UI polish](#7-ux--ui-polish)
8. [Hacky workarounds and code hygiene](#8-hacky-workarounds-and-code-hygiene)
9. [Tests, CI and delivery](#9-tests-ci-and-delivery)
10. [Known open items (from PROGRESS.md)](#10-known-open-items-from-progressmd)
11. [Prioritised plan](#11-prioritised-plan)

---

## 1. Verdict

**This is a well-built prototype that is not ready to ship to anyone else.** The code itself is better than
most production codebases:

- a clear main / preload / shared / renderer split, with zod at every boundary;
- a real kind registry;
- versioned migrations with fixtures;
- accurate docs.

What's missing is everything around the code:

- packaging, CI, logging and crash reporting;
- a security model for a renderer that displays untrusted content;
- configuration a user can change without environment variables;
- runs end to end against real GitHub and a real Claude session.

The current baseline is clean. `npm run typecheck` and `npm run lint` pass with no findings, and
`npm test` passes 302 of 303 tests (1 skipped) across 46 files.

| Area | Grade | Summary |
|---|---|---|
| Architecture / layering | A- | Clean process split, zod contracts, documented import direction |
| Extensibility: new kind | B | Real `KindModule` registry. A simple kind edits about 4 existing files; one that syncs with an outside service edits about 8–9 |
| Extensibility: new integration | C+ | About 7 files per IPC call; GitHub-specific assumptions in the domain model |
| Configuration | C | Three overlapping config sources; important values hard-coded; env vars don't reach packaged GUI apps |
| Error handling | B- | Good for user-started actions, silent for background work, no crash logging |
| Security | C | The window is hardened, but the IPC surface means a compromised renderer can run code |
| Performance | B- | Fine at current scale; long agent transcripts get steadily slower; the canvas re-renders every frame while the layout moves |
| UX polish | B- | Consistent progress toasts; no keyboard access, no undo, no light theme |
| Tests / CI | C | Strong logic tests; no component tests, no e2e tests, no CI |
| Ship-ability | D | No installer, signing, icon or update path; version 0.0.0; personal demo world hard-coded |

---

## 2. Extensibility

### 2.1 Adding a new item kind

**You implement a module object, not a class, and edit about 4 existing files.** `KindModule`
(`R/kinds/types.ts`) covers label, icon, radius, level, ring, facts, badges, actions, primary action,
Sidebar and the `addable` hooks. `KindModules = {[K in Kind]: KindModule<K>}` makes the compiler enforce
that every kind is registered. The canvas, HUD, sidebar shell, add dialog, filter, hover card and layout
metrics contain no per-kind code. `registry.test.ts` checks that every module is complete and that every
`addable` creates a valid item.

**Checklist for a local-only kind `foo`** (traced for `deployment`):

| # | File | Edit | Enforced by |
|---|---|---|---|
| 1 | `R/kinds/foo/*` | `index.tsx`, `Sidebar.tsx`, `model.ts`, tests | (new) |
| 2 | `R/domain/schemas.ts` | **4 spots**: `KINDS` (:35), `FooDataSchema`, `ItemSchemas` map (:256), the `ItemSchema` union (:261) | tsc, partly |
| 3 | `R/kinds/registry.ts` | import + `MODULES` entry | tsc |
| 4 | `R/chat/prompt.ts:27` | a case in `contextLine`'s `switch (item.kind)` | **nothing**: ✔ a fallback `return` hides a missing case |
| 5 | `R/seed.ts` / `R/testing/fakeWorld.ts` | at least one demo item | `registry.test.ts` |
| 6 | `R/kinds/icons.tsx`, `R/domain/types.ts` | icon, type re-export | optional |

A kind that **syncs** with an outside service, or is backed by a process or a working folder, also edits:

- `R/sync/refresher.ts:52-76`, a `switch(kind)` that maps kinds to refresh jobs, with per-kind refresh
  functions in generic code. It imports `kinds/build/logic` and `kinds/pr/builds`.
- `R/sync/live.ts:25-29, 140-150`, with `if (kind === 'agent' | 'app' | 'testrun')` branches.
- `R/actions.tsx:25-29`, where multi-select actions are hard-coded by kind name.
- `R/chat/prompt.ts:96-129` and `R/actions.tsx:59,112`. These look up an item's working folder from a
  hard-coded list of kinds, using the cast `(m.data as {cwd: string}).cwd`.

**Findings**

| Sev | Finding | Fix |
|---|---|---|
| High | ✔ One kind's schema is spread over 4 places in central `schemas.ts`. `ItemSchema` re-lists the `ItemSchemas` keys by hand instead of deriving them (`schemas.ts:261-273`) | One tuple of schemas; derive `KINDS` and `ItemSchema` from it, or co-locate `kinds/<k>/schema.ts` |
| High | ✔ `chat/prompt.ts` `contextLine` switches on kind, which the `KindModule` docs say never happens, and isn't exhaustive | `KindModule.describe(item, ctx)` (required) and `cwdOf?(item)` |
| Med | Sync and live-process code knows kinds by name (above) | `KindModule.sync?: { jobs(item), reconcile? }` |
| Med | ✔ `R/kinds/project/Sidebar.tsx:12-13` imports `../deployment/model` and `../deployment/form`, which breaks CONTRIBUTING's "kinds never import another kind" rule. `project/index.tsx:42-50` counts deployments | Generic "children by kind" section that uses each kind's `Addable.open` |
| Med | Per-kind checks in generic code: `R/kinds/common.tsx:99` (`'agent' ? 'Complete' : 'Mark done'`), `R/overlays/Dialogs.tsx:75,78,150` (project exception, link labels), `R/canvas/Canvas.tsx:573` (a ticket context-menu entry) | `completeLabel`, `Addable.linkLabel`, `multiActions` on the module |
| Med | Links are untyped free strings. `LinkSchema.label: z.string()`, with labels ('for', 'deploys', 'checks', 'works on', 'stacked on', 'implements', 'runs', 'tests', 'in project', 'belongs to') scattered over about 10 files. Nothing checks which kinds may link. "Belongs to a project" is both the `projectId` field and a link | A `LinkType` registry `{id, label, from: Kind[], to: Kind[]}`, or at least a string-literal union |
| Med | `project` and `ticket` are the only colour/grouping roots: `ColorBy` enum (`schemas.ts:296`), `overlays/settings.ts:28`, the layout cluster keyed on `projectId` | `KindModule.groupRoot?` if other groupings (team, environment) are ever wanted |
| Low | `level` is one number that sets visual distance, link strength and charge (`R/layout.ts:54-80`). There's no way to say "same level as pr, but attached to worktree" | Fine for now |
| Low | No `defineKind()` helper with defaults; simple kinds repeat every field | `defineKind<K>({...})` would make a todo-sized kind about 20 lines |
| Low | `registry.ts` sets things up as an import side effect (`provideKindInfo`), so the store depends on the registry being imported first | Document it, or call it explicitly from `main.tsx` |
| Low | `registry.test.ts:75,96-113` hard-codes per-kind assertions, so the test file is also edited for every new kind | Loop over the registry |

### 2.2 Adding an IPC call or integration

One new call, traced for `gh:prEdit`:

1. `src/shared/ipc.ts`: `InvokeChannels` (:334) **and** `CortexApi` (:416). The same declaration twice.
2. `src/shared/integrationSchemas.ts`: the zod request schema.
3. `src/main/services/gh.ts`: the logic.
4. `src/main/ipc/integrations.ts`: `handle(ctx, 'gh:prEdit', …)`.
5. `src/preload/integrations.ts`: the forwarding line. The compiler doesn't check this list is complete.
6. `R/native.ts:111`: a method-name string list for the browser fallback. Not compiler-checked either.
7. `R/data/gh.ts`: the op or hook, and possibly `data/queryKeys.ts`.

That is 7 files per call, with the channel name repeated as a string in 5 of them.

**A second provider (GitLab, Bitbucket, Jenkins) is a big change today:**

- `PrData` and `BuildData` follow GitHub's data shape (`mergeStateStatus`, `repo: owner/name`).
- Kinds import `GhRun` directly (`R/kinds/build/Sidebar.tsx:8`, `build/logic.ts:2`) and call
  `ghOps.runRerun`.
- The prompt says "GitHub pull request".
- `https://github.com/${repo}` is hard-coded (`R/kinds/pr/logic.ts:13`, `project/index.tsx:70`,
  `project/Sidebar.tsx:42-44`), so even GitHub Enterprise doesn't work.
- `parseRemoteRepo` treats any `host:owner/name` remote as GitHub.

| Sev | Finding | Fix |
|---|---|---|
| Med | Hand-written preload and `native.ts` forwarders | Generate both from `Object.keys(schemas)` grouped by prefix; derive `CortexApi` from `InvokeChannels` with a mapped type |
| Med | No provider abstraction | Optional `provider` field on project/pr/build (no migration needed), a `CodeHost` interface in shared, and `data/codehost.ts` dispatching to the right provider |

---

## 3. Configuration

### 3.1 How configuration works today

There are **four separate places** settings come from, and they overlap:

| Layer | Where | Who can change it | Contents |
|---|---|---|---|
| Integration config | `DEFAULT_CONFIG` in `src/shared/integrations/config.ts`, overridden by env in `src/main/services/config.ts` (`resolveConfig`) | Whoever starts the process, via env vars | GitHub bot/comment/Renovate, Jira CLI and site, Claude binary, runner timings |
| Prefs | `prefs` inside `~/.cortex/workspace.json` (`PrefsSchema`, `R/domain/schemas.ts:302`), edited in the gear dialog (`R/overlays/settings.ts`) | User, in the UI | Model, effort, permission mode, AI-review comment, refresh interval, notifications, sound, colour-by, sidebar width |
| Per-project data | `ProjectData` items in the workspace | User, in the project form | Repo, base checkout, default branch, worktrees folder, start/test command |
| Hard-coded constants | All over the source | Nobody, without a rebuild | See 3.2 |

**Environment variables read** (✔ grepped):

- **User-facing:** `CORTEX_USER_DATA`, `CORTEX_JIRA_CLI`, `CORTEX_JIRA_SITE`, `CORTEX_CLAUDE_BIN`,
  `CORTEX_AI_REVIEW_COMMENT`, `CORTEX_RENOVATE_APP`.
- **Dev / test:** `CORTEX_JIRA_MOCK_SCRIPT`, `JIRA_MOCK_DB`, `JIRA_MOCK_SITE`, `CORTEX_SMOKE*` (7 vars),
  `CORTEX_LIVE_GH*`, `CORTEX_T`, `ELECTRON_RENDERER_URL`.

**Problems with this setup**

- **Env vars don't work for a packaged desktop app.** On macOS an app started from the Dock or Finder
  doesn't inherit your shell environment. On Windows, a Start-menu launch only sees *system or user* env
  vars, not anything from `.bashrc` or `$PROFILE`. So once Cortex is installed, every `CORTEX_*` setting is
  effectively unreachable.
- **Some config fields have no override at all.** `github.aiReviewBot`, `github.renovateLabel`,
  `claude.defaultPermissionMode`, `claude.prefixArgs`, `runners.flushMs` and `runners.runningAfterMs` exist
  in `IntegrationConfig`, but `resolveConfig` only reads the 6 env vars listed above. Those fields are
  config in name only.
- **`aiReviewComment` lives in two places.** It can be set by env (main config) *and* by prefs (UI), with
  prefs taking precedence. The `'@claude review'` fallback is repeated a third time in
  `R/kinds/pr/actions.tsx:27`.
- **Machine settings are mixed into the workspace.** The Claude model, permission mode and refresh
  interval are personal or machine settings, but they're saved in `workspace.json`, the same file as the
  canvas. Reset the workspace or switch to another one and you lose your settings. Share a workspace file
  and you share your permission mode.
- **Team settings can't be shared.** Start/test command, default branch and branch naming are per-project,
  but they're stored in the user's workspace. A team can't commit them to the repo.
- **Dev overrides work in production.** `CORTEX_CLAUDE_BIN` (run any binary or `.js`),
  `CORTEX_JIRA_MOCK_SCRIPT`, `CORTEX_SMOKE` and `ELECTRON_RENDERER_URL` aren't gated on `!app.isPackaged`.

### 3.2 Values someone would want to tweak but can't

**Workflow / team conventions (most likely to be requested)**

| Value | Where | Why someone would change it |
|---|---|---|
| Branch name for a ticket: `KEY-slug` | `R/kinds/project/worktreeModel.ts:33` `branchForTicket` | Teams use `feat/KEY-slug`, `user/KEY`, `bugfix/…` |
| Ticket-key regex `/[A-Z][A-Z0-9]+-\d+/` | `worktreeModel.ts:36`, duplicated in `R/kinds/record/model.ts:53` | Different key formats; a separate tracker |
| Default worktrees folder `../wt/<name>` | `R/kinds/project/settings.tsx:28`, `worktreeModel.ts:39` | Personal disk layout (editable per project, but the default isn't) |
| Records folder `<baseDir>/records/<branch>/` | `R/kinds/record/discovery.ts:28` `recordsDir` | Many repos won't want a `records/` folder at the root; `.cortex/records`, `docs/plans`, or outside the repo |
| Default merge method `squash` | `R/kinds/pr/logic.ts:76` | Repos that allow only merge commits or rebase |
| Start/test command detection only knows npm | `R/kinds/project/settings.tsx:35-36` | pnpm / yarn / bun / make / cargo / go users |
| Default branch fallback `'main'` | `settings.tsx:65`, `R/kinds/pr/index.tsx:103`, `build/index.tsx:101`, migrations | `master`, `develop`, `trunk` |
| Deployment stages enum `dev|staging|prod|custom`, plus the `guessStage` URL regex | `R/domain/schemas.ts:217`, `R/kinds/deployment/model.ts:6,13` | `qa`, `uat`, `preprod`, … (`custom` is a workaround) |
| Skill list (the `/plan`, `/grill`, `/implement`, … actions) | `R/chat/skills.ts:5`, plus `skill(...)` calls in kind modules and `SKILL_ICONS` (`R/kinds/icons.tsx:78`) | Bubble actions can't call your own skills or rename the built-in ones. The skills themselves must exist in Claude Code, and Cortex doesn't ship them |
| AI review bot `claude[bot]`, Renovate label `renovate` | `src/shared/integrations/config.ts` (no override) | A different review bot; Dependabot instead of Renovate |
| PR comments shown `COMMENTS = 5` | `R/kinds/pr/Sidebar.tsx:29` | Minor |

**Integrations / environment**

| Value | Where | Why |
|---|---|---|
| **Jira custom fields** `storyPoints: customfield_10016`, `sprint: customfield_10020` | `src/shared/integrations/jira.ts:91` | **These IDs differ per Jira site.** On most sites other than the dev's, story points and sprint will show nothing or the wrong data. `docs/ARCHITECTURE.md` already says they're unverified |
| GitHub host `https://github.com` | `R/kinds/pr/logic.ts:13`, `R/kinds/project/*` | GitHub Enterprise Server |
| Editor `code` | `src/main/ipc/desktop.ts:37` | Cursor, JetBrains, Zed, vim. On failure it silently falls back to `openPath` |
| Claude context window `200_000` | `R/kinds/agent/usage.ts:8`, duplicated in `R/sync/mapping.ts:19` | 1M-context models show a wrong usage bar before the first turn |
| Exec timeout 120 s, output cap 20 MB | `src/main/lib/exec.ts:15,17` | Large monorepos, slow networks |
| Rebase timeout 300 s, Jira auth probe 15 s, Claude catalog probe 20 s, `initJira` race 10 s | `src/main/services/git.ts:122`, `jira.ts:100`, `claude.ts:479`, `ipc/integrations.ts:10` | Slow machines and VPNs |
| Refresher tick 5 s, fast interval 15 s, parallelism 3, git log limits 200/500 | `R/sync/refresher.ts:25-27,91,133` | Only `refreshSec` is exposed; people hitting API rate limits want the rest |
| Log buffer 256 KB, log view 2000 lines, large-diff threshold 800 lines | `R/sync/live.ts:23`, `R/components/viewers/log/LogView.tsx:43`, `diff/DiffViewerImpl.tsx:144` | Long-running dev servers, big diffs |
| File listing cap 20 000 entries | `src/main/lib/files.ts:7` | Large repos |

**UI**

| Value | Where | Notes |
|---|---|---|
| Keyboard shortcuts (`/`, Ctrl+K, F, Delete, Ctrl+A, Enter, Esc) | `R/canvas/Canvas.tsx:287-312` | Not rebindable, and not shown anywhere in the UI |
| Zoom limits 0.25–2.2, chat and top spacing 170/70 | `Canvas.tsx:33-37` | Duplicated between TS and CSS |
| Theme (dark only) | `R/index.css:9-27` | No light mode, no "follow the OS" |
| Notification sound | `R/sound.ts` | On/off only |
| Backdrop particles, bubble float animation | `R/canvas/Backdrop.tsx`, `index.css:133` | No "reduce animation" setting beyond the OS `prefers-reduced-motion` |

**Dead or leftover hard-coding**

- ✔ `R/layout.ts:34-38` pins cluster centres for project IDs `p-ingest`, `p-console` and `p-alert`.
  Those are from the old fake demo world and no longer exist.
- `R/persist.ts:40` still detects the legacy `ctx-observability/` demo world.
- `R/seed.ts:17,32-53,66,97,105` hard-code the demo world: `sweedee/cortex-demo`,
  `~/Documents/cortex-demo`, `~/Documents/wt/cortex-demo`, author `sweedee` and `sweedee/cortex`.
  `src/main/smoke.ts:103` falls back to `sweedee/cortex`.
- `R/components/viewers/Gallery.tsx:89` hard-codes `http://localhost:5173`.

### 3.3 Should env vars become a JSON config? Yes, mostly

**Recommendation:** move user-facing settings into a zod-validated `~/.cortex/config.json`, and keep env
vars only as **dev/test overrides** that are ignored when `app.isPackaged`. Specifically:

1. **`~/.cortex/config.json`: machine/user settings.**
   - Resolve in this order: `DEFAULT_CONFIG` ← `config.json` ← env (dev only).
   - Validate with zod using the same `.catch(default)` approach as `PrefsSchema`, so one bad value falls
     back to its default instead of breaking startup.
   - Watch the file and push changes to the renderer, since a `fs:watch` already exists.
   - Write a commented example (or a `$schema` reference) on first run so it's discoverable.
2. **Move the gear-dialog prefs into it.** Model, effort, permission mode, refresh interval,
   notifications, sound, AI-review comment and editor are user settings, not workspace state. They should
   survive a workspace reset and not travel with a shared workspace file. The gear dialog then edits
   `config.json` through one IPC channel. Keep UI state (camera, filter, sidebar width, colour-by) in the
   workspace.
3. **Optional per-repo `.cortex.json` (or `.cortex/config.json`) in the repository.** Teams could commit:
   - branch template (`feat/{key}-{slug}`)
   - records folder
   - start/test commands
   - default merge method
   - deployment stages
   - Jira project key and custom-field IDs
   - extra skills/actions

   The project form would show these as inherited defaults. This is also the natural home for "which
   provider is this repo on" (§2.2).
4. **Keep as env vars:** `CORTEX_USER_DATA` (it must be known before the config file is found),
   `CORTEX_SMOKE*`, `CORTEX_LIVE_GH*`, `ELECTRON_RENDERER_URL`, `JIRA_MOCK_*`. Gate everything except
   `CORTEX_USER_DATA` on `!app.isPackaged`.
5. **Put a rough schema in one place:**

   ```jsonc
   {
     "editor": { "command": "code", "args": ["{path}"] },
     "claude": { "bin": "claude", "model": null, "effort": null, "permissionMode": "default", "contextWindow": 200000 },
     "github": { "host": "github.com", "aiReviewComment": "@claude review", "aiReviewBot": "claude[bot]",
                 "renovate": { "app": "renovate", "label": "renovate" } },
     "jira":   { "cli": "acli", "site": null, "fields": { "storyPoints": "customfield_10016", "sprint": "customfield_10020" } },
     "git":    { "branchTemplate": "{key}-{slug}", "defaultBranch": "main", "worktreesDir": "../wt/{repo}" },
     "records":{ "dir": "records" },
     "refresh":{ "intervalSec": 60, "fastSec": 15, "parallel": 3 },
     "limits": { "execTimeoutSec": 120, "rebaseTimeoutSec": 300, "outputCapMb": 20, "logBufferKb": 256 },
     "ui":     { "theme": "dark", "notifications": true, "sound": true, "animations": true }
   }
   ```

**What this costs:** one zod schema in `shared/`, one loader in main that replaces most of
`resolveConfig`, a config IPC channel, and a migration step that moves today's prefs out of
`workspace.json` (the migrations framework already supports this). The settings dialog stays almost the
same.

---

## 4. Error handling and robustness (main process)

**High**

- **H4 ✔ A corrupt workspace file destroys the good backup** (`src/main/lib/workspaceFile.ts:59`).
  `drain()` copies `workspace.json` to `.bak` before every save without checking the current file. If the
  main file is corrupt, `load()` falls back to `.bak`, and the first autosave then copies the corrupt file
  over that `.bak`. Only one backup generation is kept.
  - **Fix:** rotate only if the current file parses. Keep N timestamped backups. On a failed load, rename
    the bad file to `workspace.corrupt-<ts>.json`.
- **M1 ✔ No crash handling or logging.**
  - There's no `process.on('uncaughtException' | 'unhandledRejection')`, no `crashReporter`, no log file;
    there are about 20 `console.*` calls, and in a packaged Windows app stdout goes nowhere.
  - An exception in the Claude stream reducer (`src/main/services/claude.ts:233-242`, `onEvent` in the
    stdout handler) is uncaught in main and leaves the line buffer half-consumed.
  - `void workspace.flush().finally(...)` (`src/main/index.ts:266`) has no `.catch`.
  - `render-process-gone` is only logged (`window.ts:109`).
  - **Fix:** a rotating log in `~/.cortex/logs`, try/catch around `onEvent`, and offer a reload when the
    renderer process dies.

**Medium**

- **Errors reach the UI as plain strings** (`src/main/ipc/handle.ts:21-26`). Electron turns them into
  `Error invoking remote method 'x': …`, so `CliError.code`, stderr, exit code and zod issues are lost. The
  UI can only tell CLI-missing, auth failure, timeout and validation apart by regex on the message.
  - **Fix:** return `{ok:false, error:{code:'CLI_MISSING'|'TIMEOUT'|'EXIT'|'VALIDATION'|'FORBIDDEN',
    message, stderr?, exitCode?}}`, or encode the details as JSON in the message.
- **The CLIs' JSON output is cast, not validated.** `parseJson<T>` (`src/main/services/cli.ts:129`) is used
  for all `gh` and `acli` output. A change in either tool's output gives `undefined` deep in the UI instead
  of a clear error. The captured acli fixtures would make zod tests cheap.
- **Parsing depends on English text:**
  - `/conflict/i` (`github.ts:275`)
  - `/no checks reported/i` (`gh.ts:130`)
  - `Site:` and `✗` (`jira.ts:85,114`)
  - the worktree removal retry, which matches `/permission denied|being used|resource busy|directory not
    empty/i` (`R/kinds/worktree/actions.tsx:218`)
  - Jira transitions use localized display names
  - git runs without `LC_ALL=C`
- **Processes can hang on macOS/Linux.** A timeout only sends SIGTERM (`src/main/lib/killTree.ts:116`) and
  never follows up with SIGKILL, so a child that ignores it hangs `runExec` forever. The 2 s stop timer in
  `claude.ts:553` has the same weakness. Windows is fine (`taskkill /F`).
- **Claude session lifecycle** (`src/main/services/claude.ts`):
  - `e.events` grows without limit in main memory (:292), and `claude:transcript` returns the whole
    array in one IPC message.
  - The stdout line buffer has no size cap.
  - `stdin.write` backpressure is ignored.
  - A corrupt `claude-sessions.json` is silently reset (:169) and isn't zod-validated.
  - Session-list saves use `.catch(() => {})` (:193), and `flush()` is never called from `before-quit`,
    so the latest `sessionId` and cost can be lost.
  - `stopAll` hard-kills (:590-597) instead of closing stdin cleanly, which can truncate the transcript
    that `--resume` relies on.
  - A missing working folder is reported as "Could not start claude".
  - Nothing detects a hung CLI (no inactivity watchdog), and there's no restart backoff.
  - `--append-system-prompt` is passed as an argument. If `claude` resolves to an npm `.cmd` shim,
    multi-line text goes through `cmd.exe` quoting.
- **The output cap is silent.** `runExec` truncates at 20 MB per stream (`exec.ts:34`) without telling the
  caller, and re-copies the string near the cap.
  - **Fix:** collect chunks in an array, add `truncated: true`, and stop reading at the cap.
- **Quit is slow and duplicated.** `ProcManager.stopAll` runs a synchronous `taskkill` per process, which
  can block quit. `process.on('exit')` is registered twice (`exec.ts:243`, `ipc/integrations.ts:405`).

**Low**

- `window-state.json` is accepted with only a finite-number check, so a width of 0 or 1e9 passes
  (`window.ts:18`).
- `fs:list`:
  - one EACCES subdirectory aborts the whole walk (`files.ts:331`);
  - the walk has no time bound;
  - the glob-to-regex conversion could be slow on pathological patterns (`lib/glob.ts`).
- `fs.watch(recursive)` on huge roots is unbounded (`watchers.ts`).
- The `OutputBatcher` buffer is unbounded while the window is busy, and events are silently dropped
  after the window is destroyed.

**Done well**

- **Process spawning:**
  - cross-spawn with `shell:false` and `windowsHide`;
  - process-tree kill (`taskkill /T /F` on Windows, process groups on POSIX);
  - ENOENT reported as `Could not run <cmd>`;
  - EPIPE handled;
  - `GIT_TERMINAL_PROMPT=0` / `GH_PROMPT_DISABLED`.
- **File writes:**
  - `atomicWrite`: temp file, fsync, rename, with EPERM/EBUSY retry;
  - writes serialized with last-wins coalescing;
  - flush on `before-quit`;
  - the userData migration copies and never deletes.
- **Claude stream handling:**
  - line-buffered NDJSON with a final flush;
  - unknown control requests are answered so the CLI doesn't hang;
  - `AskUserQuestion` is parked and answered.
- **CLI errors:** `CliError` carries the command, exit code and stderr. The acli "exit 0 but FAILURE"
  case is handled.

---

## 5. Security

**Done well:**

- **Window:** `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP (`script-src 'self'`,
  `object-src 'none'`), and `ipcRenderer` is never exposed.
- **IPC:** zod on every channel with a compile-time check that schemas match the contract; the IPC
  sender is checked.
- **Input checks:** paths must be absolute and free of NUL bytes; `openExternal` accepts http(s) only;
  `ref` values can't start with `-`, so they can't become git options.
- **Embedded pages:** webviews get the preload stripped and `sandbox` forced.

**The problem: the renderer is fully trusted, and it renders untrusted content** (PR bodies, Jira
descriptions, LLM output, embedded GitHub and Jira pages). Any XSS in the renderer can therefore run code
on the machine.

| Sev | Finding | Fix |
|---|---|---|
| High | ✔ `EXEC_ALLOWLIST` includes `node` (`src/shared/ipc.ts:8`) with arbitrary args, so `node -e …` runs anything. `env` is merged over `process.env`, so it can set `NODE_OPTIONS`, `GIT_SSH_COMMAND`, `LD_PRELOAD` (`exec.ts:26`). `proc:start` accepts `shell:true` with any command (`procManager.ts:155`). `fs:readText` / `fs:writeText` accept any absolute path (`files.ts:272`), so `~/.ssh` and Startup folders are reachable. `shell:openPath` launches `.exe` / `.bat` / `.lnk` (`desktop.ts:150`) | Drop `node`; whitelist env keys; restrict `fs:*` / `openPath` to registered roots (project dirs, `~/.cortex`); refuse executable extensions |
| High | ✔ No `setPermissionRequestHandler` / `setPermissionCheckHandler` anywhere. Embedded pages get Electron's default permission handling, which the agent reports grants camera, mic and location. `will-attach-webview` (`window.ts:99-105`) checks neither the `src` scheme (`file://` is accepted) nor the partition. Guest pages have no `will-navigate`, redirect or download guard | Require http(s) `src` and one of the known partitions; `cb(false)` permission handlers per session; navigation guards |
| Med | ✔ Smoke harness ships in production. It's imported statically (`src/main/index.ts:6`), and `CORTEX_SMOKE=1` makes the app run `executeJavaScript`, create repos and `process.exit`. `CORTEX_CLAUDE_BIN` runs any binary. `jira-mock` stays allowlisted | Dynamic import only when `!app.isPackaged`; ignore dev env vars in packaged builds |
| Med | `permissionMode: bypassPermissions` / `dontAsk` are accepted from the renderer with no confirmation or policy in main (`integrationSchemas.ts:85,111`) | Confirm in main, or allow only via config |
| Med | Parent secrets (`GH_TOKEN`, `ANTHROPIC_API_KEY`) flow into every child process, including user dev servers via `proc:start`. Probably intended, but not documented | Document it, or scrub for `proc:start` |
| Low | `dangerouslySetInnerHTML` in `R/components/viewers/markdown/MarkdownImpl.tsx:38` and `Mermaid.tsx:87`. Mitigated by CSP, by not using rehype-raw, and by mermaid's `strict` mode | Keep it that way; add a test |
| Low | `handle.ts:24` checks `e.sender` but not `e.senderFrame`. Fine until an iframe is ever loaded in the main window | Compare to `mainFrame` |
| Low | Navigation guards use regex / `startsWith` instead of `new URL().origin` (`window.ts:29`) | Compare by origin |

---

## 6. Performance (renderer)

| Sev | Finding | Fix |
|---|---|---|
| High | ✔ **Agent transcripts slow down the longer they run.** Every `claude:event` copies the array (`R/sync/live.ts:98`, `[...old, event]`). ✔ The sidebar then re-processes the whole log from scratch (`R/kinds/agent/Sidebar.tsx:76` `buildTranscript`). `byParent` is rebuilt with spreads (`transcript.ts:189`), `groupRows` isn't memoized (`Sidebar.tsx:112`), and rows aren't `React.memo`'d, so every token re-renders every row, including markdown. The cache has `staleTime: Infinity` and no cap | Process events incrementally, memoize rows, batch per animation frame, cap or virtualize, evict on close |
| High/Med | ✔ **The canvas re-renders every frame while the layout moves** (`R/canvas/Canvas.tsx:51` `useLayoutTick()`). Each render runs `actionsForSelection` / `relatedItems` unmemoized, and ✔ `document.querySelector('.chatbox').getBoundingClientRect()` (`:393`) forces a layout. All bubbles re-render because x/y change, and links are rebuilt as React SVG. Adding or removing a bubble, or changing the link count, restarts the simulation at alpha 0.6 (`layout.ts:158`) | Write positions via refs in `onTick`; draw links imperatively; ResizeObserver for the chat rect; skip offscreen bubbles |
| Med | **Editing one bubble re-renders many components.** `patchItem` / `patchData` remap the whole array (`store.ts:241-251`). Canvas, Hud, ChatBox and Sidebar subscribe to the full `items` array, so every refresh patch recomputes `viewsOf` / `groupColors` / `visibleSet` / `ctxOf` | Per-item selectors, `useShallow`, maybe a Map by id |
| Med | **Every chat keystroke re-renders the canvas.** The draft lives in the global store and `Canvas` subscribes to it (`Canvas.tsx:46`). `autoMention` builds RegExps per keystroke (`store.ts:171`), and ChatBox rebuilds the popup options each keystroke (`ChatBox.tsx:84-100`) | Shallow-compared `mentionedIds` selector, or keep the draft local |
| Low/Med | **Constant animation.** The backdrop rAF loop runs forever while the window is visible (`R/canvas/Backdrop.tsx:105-127`). Every bubble has an infinite `float` animation (`index.css:133`). `.world { will-change: transform }` creates one huge layer | 30 fps cap and idle pause; animate only selected or running bubbles |
| Low/Med | **Refresh cost.** Up to 5 git calls per worktree per cycle (`refresher.ts:89-100`, `log -n 500` twice). No dedupe with sidebar queries (30 s `staleTime`), so opening a sidebar can repeat the same call | Share query keys and staleTime with the refresher |
| Low | **Persistence writes ephemeral data.** It's debounced (500 ms) but saves `outputTail` and live agent fields. `beforeunload` calls an async IPC that may not finish | Exclude ephemeral fields; flush from main on close |
| Low | **Uncleaned timers:** `Canvas.tsx:78` (900 ms), `:592` (`fitTo` after 50 ms), `ChatBox.tsx:292` (blur after 120 ms) | Clear in effect cleanup; `onMouseDown preventDefault` instead of the blur delay |

**Done well:**

- **Layout:** d3 positions live outside React, ticks are rAF-throttled, and a 220-tick warm-up means the
  first paint is already settled. The simulation stops after about 180 ticks. The camera is a single CSS
  transform.
- **Rendering:** `Bubble` is memoized, and the derived views are cached on array identity.
- **Loading:** markdown, diff2html and CodeMirror are lazy-loaded; mermaid is imported on demand.
- **Refresher:** it limits concurrency, backs off per item and per repo, and pauses when the window is
  hidden. Logs are capped (`LOG_MAX`).

---

## 7. UX / UI polish

| Sev | Finding | Fix |
|---|---|---|
| Med | **Background failures are invisible.** After the first failure the refresher only logs to the console and backs off (`R/sync/refresher.ts:178-193`). Bubbles keep showing stale data with no "sync failing" or "last updated" signal. `R/kinds/ticket/actions.ts:54` silently reverts a failed status change. `R/kinds/pr/actions.tsx:27` silently falls back to a default comment | Warning badge and tooltip per failing item; a toast on the first failure per repo |
| Med | **No undo.** "Remove from canvas" and Ctrl+A → Delete remove bubbles, links, positions and notices immediately (`R/kinds/common.tsx:124-133`, `R/actions.tsx:192`). The toast has no undo | Snapshot and Undo on the toast, or confirm when removing more than 1 |
| Med | **Accessibility.** Bubbles are `<div>`s with no `role`, `tabIndex` or `aria-*` (`R/canvas/Bubble.tsx:94-98`), so the canvas can't be used from the keyboard. Status is conveyed by colour only. `--ink-faint #61667e` on `#07080f` is about 3.6:1, below the 4.5:1 guideline. Focus doesn't return to the opener when a dialog or sidebar closes. Enter-to-submit doesn't check `isComposing`, which breaks IME input | Roving tabindex; `aria-label="{handle}, {title}, {status}"`; a list view for screen readers |
| Med | ✔ **i18n.** `react-intl` is a dependency but is never imported. All strings are English literals, plurals are hand-rolled (`R/persist.ts:80`), and dates are hand-formatted | Decide: adopt it or drop it |
| Med | **Theming and tokens.** `index.css:9-27` defines its own hex palette (about 31 hex and 16 rgba values versus 24 `var(--dt…)`). `@dynatrace/strato-design-tokens` is never imported. Dark-only, with no `color-scheme` and no light variant. z-index values are scattered magic numbers (26 is used twice: `index.css:584`, `:1314`). Layout constants are duplicated between TS and CSS (170, 70, 230, 300) | Map to Strato tokens; `--z-*` scale; light theme |
| Low | **Off the flat brief.** `text-shadow: 0 1px 6px rgba(0,0,0,.9)` on captions (`index.css:~210`) is a glow. 11 `box-shadow`s. Dead `.backdrop-glow { display: none }` | Remove or flatten |
| Low | **Duplicated UI.** The agent `Composer` (`R/kinds/agent/Sidebar.tsx:446+`) re-implements the ChatBox slash popup. The canvas context menu and `InlineActions` build the same menu separately. `agent/Sidebar.tsx` is 702 lines | Shared `SlashTextarea` and `useItemMenu`; split the agent sidebar |
| Low | Keyboard shortcuts aren't shown anywhere in the UI | Help overlay (`?`) |
| Low | Timer-based focus (`setTimeout(…, 80)`, because Strato inputs have no `autoFocus`): `R/overlays/Dialogs.tsx:67`, `R/ui/form.tsx:112` | A ref-based focus after mount |

**Done well:**

- **Progress feedback:** `runTask` gives every user-started action a spinner, then success or error,
  with `errorText` cleaning Electron prefixes. Opening a URL or file and the agent answer, permission and
  interrupt flows all report failures.
- **Loading and empty states:** lazy viewers show a "Loading…" status, and there's "No messages yet" /
  "All caught up".
- **Destructive actions:** worktree removal is a danger form showing dirty counts.
- **Layout and motion:** reduced-motion is respected, captions are line-clamped, and the sidebar width is
  clamped on resize.

---

## 8. Hacky workarounds and code hygiene

**Markers and type escapes**

- There are **no** TODO, FIXME or HACK markers, no `@ts-ignore`, no `as any` and no `: any`.
- There are 7 `oxlint-disable` comments and 4 stale `eslint-disable` comments (ESLint isn't installed):
  `Canvas.tsx:81`, `CodeEditorImpl.tsx:111`, `webview.d.ts:4`, `runners.ts:72`.
- There are about 240 non-`const` casts and about 58 non-null assertions in non-test code:

  | File | Casts | Non-null assertions |
  |---|---|---|
  | `src/shared/integrations/claude.ts` | 22 | |
  | `R/canvas/Canvas.tsx` | 11 | 9 |
  | `R/domain/migrations.ts` | 10 | |
  | `R/store.ts` | 9 | 3 |
  | `src/main/services/claude.ts` | 8 | |
  | `R/data/git.ts` | | 7 |
  | `R/data/gh.ts` | | 7 |
  | `R/overlays/Hud.tsx` | | 6 |

- There are 7 `as unknown as` outside tests.
- `noUncheckedIndexedAccess` is off.

**Timing workarounds (about 20)**

| Delay | Where | What it papers over |
|---|---|---|
| 80 ms focus | `Dialogs.tsx:67`, `ui/form.tsx:112` | Strato inputs have no `autoFocus` |
| 120 ms blur | `ChatBox.tsx:292`, `agent/Sidebar.tsx:555` | Popup closing before a click lands |
| `fitTo` after 50 ms | `Canvas.tsx:592` | Reset, waiting for state to flush |
| `sleep(1500)`, then `sleep(2500)` + retry | `R/kinds/worktree/actions.tsx:213-220` | Removing a worktree while a file handle is held, retried by matching the error message |
| 50 ms polling loop (15 s cap) | `src/main/services/runners.ts:110` | Waiting for a process to exit |
| "alive for 8 s = running" | `runners.ts:96` | Deciding an app has started |
| 10 s `Promise.race` | `ipc/integrations.ts:10` | Jira start-up |
| `/unknown app/i` match | `R/kinds/app/ops.ts:59` | Deciding whether to restart an app |

**Silent error swallowing (about 25 sites)**

- Main process:
  - `src/main/services/claude.ts:112,169,193,465`
  - `gh.ts:146` (`.catch(() => [])` hides a bad label)
  - `window.ts:24`
  - `smoke.ts:178` (an empty `catch {}`)
- Viewers: `R/components/viewers/web/WebPanel.tsx:92-114`.
- Kinds:
  - `R/kinds/record/discovery.ts:40,49,101`
  - `R/kinds/record/useRecordFile.ts:56,65`
  - `R/kinds/project/settings.tsx:29,37`
  - `R/kinds/build/logic.ts:23`
  - `R/kinds/pr/actions.tsx:27`
- Other renderer code:
  - `R/overlays/settings.ts:55-57`
  - `R/data/git.ts:71`
  - `R/domain/migrations.ts:234`
  - `R/sound.ts:46`
  - `R/native.ts:56,63`
  - `R/sync/refresher.ts:97`

**Dead code**

- Unused dependencies: ✔ `react-intl` and `@dynatrace/strato-design-tokens`.
- Unused exports:
  - `useIntegrationConfig`, `useApps`, `useClaudeSessions`, `usePrSummary`, `useCurrentBranch`,
    `useRemoteRepo`, `useJiraIssueSummary`, `useJiraSearch`, `useTestRuns`
  - `JIRA_STATUSES`, `DEMO_JIRA_PROJECT`
- ✔ The `layout.ts:34-38` cluster pins for demo IDs that no longer exist.

**Duplicated helpers**

| Helper | Defined in |
|---|---|
| `sleep` | 4 places |
| `str`, `num` | 3 places each |
| `slug` / `uniqueHandle` | `R/kinds/deployment/form.ts:12-17`, `R/kinds/project/settings.tsx:43-47` (same code) |
| `parentOf`, `baseName` | `project/settings.tsx`, `worktreeModel.ts`, `record/model.ts` |
| `ticketKeyOf` | `worktreeModel.ts:36`, `record/model.ts:53` |
| `normPath` | `record/model.ts:10`, `worktree/model.ts:108`, **with different rules** (one is case-insensitive) |
| `hostOf` | `build/logic.ts:20`, `deployment/form.ts:20` |
| `duration` | 2 places, with different output formats |
| `firstLine` | 2 places, with different signatures |
| Error-to-text | `errorText` in `R/ui/task.tsx:13`, plus an inline `text(e)` in `R/kinds/ticket/model.ts:41` |
| Context window `200_000` | 2 places |
| Default prefs (60 / 360) | 4 places |

**Logging:** about 20 `console.*` calls, and no logger abstraction. `window.ts:108-114` mirrors renderer
console messages at warning level and above.

**Large files:**

| File | Lines |
|---|---|
| `R/kinds/agent/Sidebar.tsx` | 702 |
| `R/canvas/Canvas.tsx` | 611 (rendering, hit-testing, context menu and camera in one) |
| `R/chat/ChatBox.tsx` | 405 |
| `R/overlays/Hud.tsx` | 341 (HUD, filter popover and notifications in one) |
| `R/kinds/pr/Sidebar.tsx` | 339 |

**Tooling:**

- **TypeScript:** `strict`, `noUnused*` and `verbatimModuleSyntax` are on. Off: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`.
- **Lint:** oxlint runs only the `correctness` category.
- **Formatting:** no formatter, no `.editorconfig`.
- **package.json:** no `engines` field (the README requires Node 22.12+). Versions are a mix of exact pins
  and `^` ranges (react, d3-force, strato, vite, `@types/*`). No Renovate config for this repo.
- **Install:** two documented workarounds, the npm `edgesOut` crash (`npx npm@11.21.2 install`) and
  `node node_modules/electron/install.js`.

---

## 9. Tests, CI and delivery

**Tests:** 46 files (12 main, 6 shared, 28 renderer), all logic tests in vitest's node environment.
Coverage is strong for services (with captured `acli` fixtures and a fake Claude CLI), migrations, the
registry completeness test, stores and parsers.

**Not tested**

- **React components:** none at all, since there's no jsdom or testing-library.
  - all of `R/canvas/*` and `R/layout.ts`;
  - all 11 kind sidebars and the viewers;
  - `R/chat/ChatBox.tsx`, `R/overlays/*` and `R/ui/form.tsx`.
- **IPC layer:** `src/main/ipc/*` registration, `handle()` sender enforcement, and the channel schemas in
  `src/shared/integrationSchemas.ts`. `validate.test.ts` has only 6 cases.
- **Main-process helpers:** `atomicWrite`, `killTree`, `watchers`, `batcher`, `files.listDir`, `glob` and
  `window.ts`.
- **Failure scenarios:**
  - a corrupt `.bak` (H4);
  - a corrupt Claude session store;
  - stdout lines split across chunks, or oversized lines;
  - a crash with questions pending;
  - quitting mid-turn.
- **End to end:** none. The `CORTEX_SMOKE*` harness is manual, needs env vars, and isn't wired to any npm
  script.

**CI:** none. There is no `.github/`, no husky and no lint-staged.

**Delivery:**

- There's no electron-builder or forge, no installer, no code signing and no auto-update.
- There's no app icon: `public/favicon.svg` can't be used for a native window icon (`desktop.ts:187`).
- Version is `0.0.0`.
- Code that only matters in a packaged app has never run: asar paths, the `scripts/jira-mock` that must
  ship unpacked (`config.ts:178`), `ELECTRON_RUN_AS_NODE`, and the `app.isPackaged` branches.
- The first-run demo world points at your own repo and folders (§3.2). If they're missing, a new user
  gets an empty canvas.
- Without `acli`, Jira silently switches to the mock's fake `example.atlassian.net` data. Only a `note`
  field explains why.

---

## 10. Known open items (from PROGRESS.md)

1. **First real runs aren't done.** `gh pr create`, merge, comment, update-branch and `edit --base` have
   never run against real GitHub. The AskUserQuestion and permission-prompt flow was only verified
   against the fake Claude CLI.
2. **Packaging is not set up**, including shipping the jira-mock unpacked.
3. **acli output shape** on real sites, and the custom-field IDs, are unverified (`docs/ARCHITECTURE.md`).
4. **UI gaps:**
   - diffs omit untracked files;
   - the chat dock is narrow when the sidebar is wide;
   - the "Change status" icon is a caret;
   - the status list only knows statuses already in use;
   - the context window is assumed to be 200k before the first turn.
5. **Dev-mode CSP with hot reload** hasn't been exercised.
6. **Stale entries:** PROGRESS.md still lists the composer's missing skill autocomplete and model picker,
   but phase 5 added both.

---

## 11. Prioritised plan

**Now (correctness, data safety, security)**

1. **Back up only a valid workspace file.** Fix the rotation so `.bak` is only written from a file that
   parses, keep timestamped backups, and set the corrupt file aside on load (§4 H4).
2. **Lock down embedded pages.** Add permission handlers, validate the webview `src` and partition, and
   add navigation guards (§5).
3. **Tighten the IPC surface.** Drop `node` from `EXEC_ALLOWLIST`, whitelist env keys, and restrict
   `fs:*` and `openPath` to registered roots (§5).
4. **Strip dev code from packaged builds.** Load the smoke harness only when `!app.isPackaged`, and
   ignore the dev env vars in packaged builds (§5).
5. **Crash handlers and a log file** in `~/.cortex/logs`, plus a try/catch around the Claude
   `onEvent` reducer (§4 M1).

**Next (users notice these)**

6. **Agent transcripts:** process events incrementally, memoize rows, cap the length (§6).
7. **Show sync failures** as a "sync failing" badge per item, and add Undo to remove (§7).
8. **Configuration:** add `~/.cortex/config.json` and move machine prefs out of the workspace. Make the
   Jira custom-field IDs, branch template, editor and records folder configurable (§3).
9. **Structured IPC errors**, and zod-validate the `gh` and `acli` JSON output (§4).
10. **CI:** a GitHub Actions workflow running typecheck, lint and test (§9).

**Before distribution**

11. **Packaging:** electron-builder (nsis / dmg), `asarUnpack` for jira-mock, an icon, signing, and an
    update strategy (§9).
12. **First run:** an opt-in or generated demo world, and an explicit "Jira not configured" state instead
    of the silent mock (§9).
13. **Real-world runs:** one real Claude session and one throwaway PR (§10).

**Ongoing (maintainability)**

14. **Move kind-specific code into the module:** `KindModule.describe`, `cwdOf`, `sync` and
    `multiActions`; derive `KINDS` and `ItemSchema`; remove the project→deployment import (§2.1).
15. **Generate the IPC forwarders:** build the preload and `native.ts` lists from the schema map and
    derive `CortexApi`; add a `CodeHost` interface before a second provider (§2.2).
16. **Canvas rendering:** write positions via refs, and stop the chat draft from re-rendering the canvas
    (§6).
17. **Accessibility and theming:** keyboard and ARIA for bubbles, Strato tokens, a z-index scale, a light
    theme, and a decision on `react-intl` (§7).
18. **Cleanup:**
    - remove dead hooks and dependencies and the stale demo pins;
    - de-duplicate the helpers, especially `normPath`;
    - switch `eslint-disable` to `oxlint-disable`;
    - turn on `noUncheckedIndexedAccess`;
    - add a formatter (§8).
