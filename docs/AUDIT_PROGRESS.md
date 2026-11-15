# Audit implementation progress

Tracks the work on [AUDIT.md](AUDIT.md) §11. Item numbers match §11. Branch `app`; work starts from `971679f`.

Status: ⬜ open · 🔄 in progress · ✅ done · ⏸ deferred (needs a decision or outside access)

## Now: correctness, data safety, security

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 1 | Back up only a valid workspace file; timestamped backups; keep the corrupt file aside (§4 H4) | sonnet | ✅ | `dcfc1c8`. 5 timestamped `workspace.json.<ts>.bak`; corrupt file → `workspace.corrupt-<ts>.json`; legacy `.bak` still loads |
| 2 | Lock down embedded pages: permission handlers, webview src/partition, navigation guards (§5) | opus | ✅ | `4a75ab7`. Deny-all permission handlers (except clipboard write), http(s)+known-partition webviews, guest navigation/popup/download guards, origin-based checks, `senderFrame` check |
| 3 | Tighten IPC: drop `node`, whitelist env keys, restrict `fs:*` / `openPath` to registered roots (§5) | opus | ✅ | `4a75ab7`. `envPolicy.ts`, `pathPolicy.ts` + `fs:setRoots`, sensitive paths always refused, executable extensions refused, confirm dialog for `bypassPermissions`/`dontAsk`. Also: `exec:run` refused in packaged builds. Open: `git:*`/`claude:start` cwd not root-checked; symlinks not resolved; children still get the full parent env |
| 4 | Strip dev code from packaged builds: smoke harness, dev env vars (§5) | opus | ✅ | `4a75ab7`. `devEnv.ts` strips dev vars when packaged; smoke harness loaded via dynamic import in dev only. Open: smoke chunk still shipped (needs a build-time define) |
| 5 | Crash handlers, log file in `~/.cortex/logs`, try/catch around Claude `onEvent` (§4 M1) | sonnet | ✅ | `dcfc1c8`. `src/main/lib/log.ts` (512 KB × 3 rotation, `<userData>/logs`); crash handlers; Reload/Quit dialog on renderer crash. Open: most `console.*` in `services/` not yet routed through the logger; no UI to view logs |

## Next: things users notice

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 6 | Agent transcripts: incremental processing, memoized rows, length cap (§6) | opus | ✅ | `3cb9f2a`. Incremental builder (~90× faster per event at 3.4k events), per-frame batching, memoized rows, 150-block display window, cache evicted on remove/archive. Open: main-side `e.events` still unbounded (drop deltas once the final message arrives); transcript refetch after send |
| 7 | Sync-failure badge per item; Undo for remove (§7) | sonnet | ✅ | `f56ea48`. Ephemeral `sync` map in store, "!" badge + sidebar line, one toast per repo; `removeItems`→snapshot / `restoreRemoved`, 6 s Undo toast. Open: shared `checks:…` jobs have no bubble badge; not checked in the running app |
| 8 | `~/.cortex/config.json`; move machine prefs out of the workspace; configurable Jira fields, branch template, editor, records folder (§3) | opus | ✅ | `46bde88`, `661fc9f`. `src/shared/userConfig.ts` (per-field `.catch`), watched `~/.cortex/config.json` + generated `config.schema.json`, `config:get/update/changed`; renderer may only patch gear-dialog keys (editor, `claude.bin`, jira/git/records are file-only); workspace v4 moves prefs into config once. Configurable: Jira field ids, branch & worktrees templates, editor, records dir, default branch, context window, Renovate, AI review bot. Packaged builds ignore the remaining `CORTEX_*` env vars. Open: per-repo `.cortex.json`; timeouts / refresher speed / GitHub host / `ui.theme` not in config yet (→ item 8b) |
| 8b | Config follow-ups: `ui.theme` (wire `useThemePref`), exec/rebase timeouts, output cap, refresher fast interval and parallelism, GitHub host | sonnet | ✅ | `802e413`. `ui.theme`/`ui.animations` (gear dialog, `useThemePref` wired, `no-animations` class), `limits.*` applied live via `main/lib/limits.ts`, `refresh.fastSec`/`parallel`, `github.host` + `repoWebUrl()` for every repo link. **Renderer tests not yet run** (blocked by item 12's in-progress `layout.ts`); re-run after 12. Open: `parseRemoteRepo` doesn't filter by host yet (on purpose, keeps Enterprise remotes working) |
| 9 | Structured IPC errors; zod-validate `gh` and `acli` JSON (§4) | sonnet | ✅ | `648e5af`. `shared/ipcError.ts` codes (CLI_MISSING/TIMEOUT/EXIT/PARSE/VALIDATION/FORBIDDEN/UNKNOWN) encoded in the IPC error; lenient zod schemas for gh/acli; git runs with `LC_ALL=C`; SIGKILL 3 s after SIGTERM; `truncated` on exec results; one `onShutdown` hook. Open: `truncated` not shown in UI; gh/acli text regexes not centralized; `/unknown app/` and worktree-removal regexes remain |
| 10 | CI: GitHub Actions typecheck, lint, test (§9) | haiku | ✅ | `b0e0b3d`. Ubuntu + Windows matrix, `engines` added. Not yet run on GitHub (branch not pushed) |

## Before distribution

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 11 | Packaging: electron-builder, `asarUnpack` jira-mock, icon, signing, updates (§9) | sonnet | ✅ | `f74c1fe`. electron-builder 26.18.1 (nsis / dmg / AppImage), `dist` / `dist:dir` / `icons` scripts, jira-mock + seed unpacked, `unpackedAsar()` path fix, icon (svg/png/ico), v0.1.0, `docs/RELEASING.md`. Renderer deps moved to devDependencies (asar 410 MB → 21 MB). Packaged Windows app starts. Open: macOS/Linux builds and the installer not run; no signing certs; auto-update not implemented; README doesn't mention `dist` yet |
| 12 | First run: opt-in demo world; explicit "Jira not configured" state (§9) | sonnet | ✅ | `d60dd92`. Empty first-run world + Welcome panel (Add a project / Load demo world); neutral static `demoWorld` (`unknown/demo`, DEMO-1..3); smoke repo from git remote or `CORTEX_SMOKE_GH_REPO`; dead demo pins and `isOldFakeDemo` removed; Gallery uses `location.origin`; packaged builds never auto-fall back to the Jira mock, `jira.unavailable` + dismissable banner. Open: not seen in a real installer; banner not in the add-ticket dialog |
| 13 | Real-world runs: real Claude session, throwaway PR (§10) | — | ⏸ | Needs the user: real GitHub and Claude accounts |

## Ongoing: maintainability

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 14 | Kind-specific code into the module: `describe`, `cwdOf`, `sync`, `multiActions`; derive `KINDS`/`ItemSchema`; remove project→deployment import (§2.1) | opus | ✅ | `ac15e0e`, `1c24af9`, `93a683a`, `9cae59e`, `1004c6e`, `692459e`, `aa361a5`, `3a95649`. `DATA_SCHEMAS` single map; typed `LinkLabel` registry (`domain/links.ts`); hooks `describe`, `cwdOf`/`paths`, `sync`, `live`, `multiActions`, `completeLabel`, `Addable.linkLabel`, `projectSection`; `defineKind`; explicit `installKindInfo()`; registry test loops. New kind = own folder + 3 shared files (was 6–7). Open: `ticket`→`project/worktreeFlow` and sidebars→`project/parts` imports; chat cwd/agent picking still in `prompt.ts`; `groupRoot` |
| 15 | Generate IPC forwarders; derive `CortexApi`; `CodeHost` interface (§2.2) | opus | ✅ | `4e91ef7`, `0cb0b24`, `2cf697f`. Channels declared once in `shared/ipc.ts` (`call<Req,Res>()`); `CortexApi` derived; preload generated by `shared/bridge.ts` (~15 lines); `native.ts` fallback map compiler-checked complete; every call takes one request object; contract test. `shared/codeHost.ts` + `data/codehost.ts`, all gh call sites go through `codeHost()`, optional `provider` on project/pr/build. New IPC call = 4 compiler-checked files (was ~7). Dev smoke passes. Open: CodeHost data shapes still GitHub's; `qk.gh.*` keys; \"GitHub\" UI text; `parseRemoteRepo` host-agnostic; webview partition `persist:github` |
| 16 | Canvas rendering: positions via refs; chat draft stops re-rendering canvas (§6) | opus | ✅ | `6685e39`, `1559633`. Positions written from layout ticks via refs (`canvas/positions.ts`), memoized links, ResizeObserver chat rect, stable views, `draftMentions` selector, gentler reheat; backdrop 30 fps with idle pause; float only on selected/running; timers cleaned. Open: offscreen culling; `patchItem` still remaps the array; **needs a hand check in the UI** (see log) |
| 17 | Accessibility and theming: keyboard/ARIA for bubbles, Strato tokens, z-index scale, light theme, `react-intl` decision (§7) | opus | ✅ | `2ca1de1` (theming), `e155513` (a11y). Tokens with dark/light/system (`R/theme.ts`), `--ink-faint` ≥ 4.5:1, `--z-*` scale, flattened shadows, shared metrics; bubbles get role/aria-label/roving tabindex/arrow-key nav, status glyphs, focus return, `useAutoFocus`, IME-safe Enter, `?` shortcuts overlay from one table. **`react-intl` must stay**: Strato's AppRoot imports it (peer dep). Open: `useThemePref()` returns `'system'` until item 8 adds `ui.theme`; screen-reader list view; hover card on focus; rebindable shortcuts |
| 18 | Cleanup: dead code, helper de-duplication (`normPath`), `oxlint-disable`, `noUncheckedIndexedAccess`, formatter (§8) | sonnet | 🔄 | Keep `react-intl` (Strato peer dep) |

## Log

- 2026-11-15: tracker created; batch 1 (items 1–5) dispatched.
- 2026-11-15: item 10 (CI) done in `b0e0b3d`; item 6 dispatched.
- 2026-11-15: items 1 and 5 done in `dcfc1c8` (310 tests pass); item 7 dispatched. Items 8 and 9 wait for the security agent, which is also editing `config.ts` and `handle.ts`.
- 2026-11-15: item 7 done in `f56ea48`; item 16 dispatched. Item 17 (a11y/theming) waits for 16, since both edit the canvas and CSS.
- 2026-11-15: item 6 done in `3cb9f2a`; items 2–4 done in `4a75ab7` (343 tests pass; dev smoke runs pass). Items 8 and 9 dispatched.
- 2026-11-15: item 9 done in `648e5af` (381 tests pass). Item 11 dispatched.
- 2026-11-15: item 16 done in `6685e39`, `1559633`; item 17 dispatched.
- 2026-11-15: item 11 done in `f74c1fe` (packaged Windows app starts); item 17 done in `2ca1de1`, `e155513` (437 tests pass). Item 14 dispatched.
- 2026-11-15: item 8 done in `46bde88`, `661fc9f`; items 8b, 12 and 15 dispatched.
- 2026-11-15 14:40: agents for 8b, 12, 14 and 15 stopped on the 5-hour usage limit (resets 18:10 Vienna) before saving any edits. Resuming item 14 first to test whether the limit has cleared.
- 2026-11-15: item 14 done (443 tests pass); 8b, 12 and 15 resumed.
- 2026-11-15: item 8b done in `802e413` (main/shared tests pass; renderer tests to re-run once 12 lands).
- 2026-11-15: item 12 done in `d60dd92` (448/449 pass; the failure is `settings.test.ts` not yet updated for 8b's new keys). Follow-up agent fixes that and skips demo items in the refresher.
- 2026-11-15: follow-up done in `10c6646`: settings test updated; demo tickets (`unknown/demo` project) skipped by ticket sync. 450 tests pass, lint clean; typecheck waits for item 15.
- 2026-11-15: item 15 done. Whole tree checked by the coordinator: typecheck clean, lint clean, 458 tests pass (1 skipped). Note: tracker commit `4418d1f` accidentally swept in item 15's staged preload deletion (HEAD briefly broken, fixed by `4e91ef7`); tracker commits now use `git commit -- <path>`. Item 18 dispatched.

## Check by hand in the UI

Agents can't drive the GUI, so these changes have passed typecheck and tests but nobody has looked at them yet:

- **Item 7:** the "!" sync badge and tooltip; the Undo toast after Remove / Delete.
- **Item 16:** bubbles and links follow the layout after boot, add/remove, filter, drag, Auto-arrange and Reset (no flash at 0,0); the hover card and inline actions follow their bubble and flip at the right edge; chat threads start at the chat box after a sidebar resize; popup rows are still clickable. Expected visible changes: idle bubbles no longer float, particles freeze after 60 s idle, the world layer isn't permanently promoted (check pan/zoom smoothness and text sharpness).
- **Item 17:** Tab into the canvas, arrow keys, Enter / Space / Esc, focus back on the bubble after the sidebar closes; the `?` overlay; the light theme (OS light mode) incl. Strato menus, diff, CodeMirror, mermaid, log ANSI colours; whether a ✓ on every green bubble is too busy; backdrop logo opacity in light mode.
- **Item 12:** with no `workspace.json` the welcome panel shows; Add a project opens the folder form; Load demo world shows 1 project, 3 tickets, 2 PRs, 1 todo with no sync-error noise; Gallery webview loads the dev server.
- **Item 8b:** Theme select and Animations checkbox in the gear dialog.
- **Items 2–4:** a one-time confirm dialog when an agent starts in `bypassPermissions` / `dontAsk`; embedded GitHub/Jira/app pages still load.
