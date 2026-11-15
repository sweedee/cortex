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
| 8 | `~/.cortex/config.json`; move machine prefs out of the workspace; configurable Jira fields, branch template, editor, records folder (§3) | opus | 🔄 | Per-repo `.cortex.json` out of scope for now |
| 9 | Structured IPC errors; zod-validate `gh` and `acli` JSON (§4) | sonnet | ✅ | `648e5af`. `shared/ipcError.ts` codes (CLI_MISSING/TIMEOUT/EXIT/PARSE/VALIDATION/FORBIDDEN/UNKNOWN) encoded in the IPC error; lenient zod schemas for gh/acli; git runs with `LC_ALL=C`; SIGKILL 3 s after SIGTERM; `truncated` on exec results; one `onShutdown` hook. Open: `truncated` not shown in UI; gh/acli text regexes not centralized; `/unknown app/` and worktree-removal regexes remain |
| 10 | CI: GitHub Actions typecheck, lint, test (§9) | haiku | ✅ | `b0e0b3d`. Ubuntu + Windows matrix, `engines` added. Not yet run on GitHub (branch not pushed) |

## Before distribution

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 11 | Packaging: electron-builder, `asarUnpack` jira-mock, icon, signing, updates (§9) | sonnet | ✅ | `f74c1fe`. electron-builder 26.18.1 (nsis / dmg / AppImage), `dist` / `dist:dir` / `icons` scripts, jira-mock + seed unpacked, `unpackedAsar()` path fix, icon (svg/png/ico), v0.1.0, `docs/RELEASING.md`. Renderer deps moved to devDependencies (asar 410 MB → 21 MB). Packaged Windows app starts. Open: macOS/Linux builds and the installer not run; no signing certs; auto-update not implemented; README doesn't mention `dist` yet |
| 12 | First run: opt-in demo world; explicit "Jira not configured" state (§9) | | ⬜ | |
| 13 | Real-world runs: real Claude session, throwaway PR (§10) | — | ⏸ | Needs the user: real GitHub and Claude accounts |

## Ongoing: maintainability

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 14 | Kind-specific code into the module: `describe`, `cwdOf`, `sync`, `multiActions`; derive `KINDS`/`ItemSchema`; remove project→deployment import (§2.1) | opus | 🔄 | |
| 15 | Generate IPC forwarders; derive `CortexApi`; `CodeHost` interface (§2.2) | | ⬜ | |
| 16 | Canvas rendering: positions via refs; chat draft stops re-rendering canvas (§6) | opus | ✅ | `6685e39`, `1559633`. Positions written from layout ticks via refs (`canvas/positions.ts`), memoized links, ResizeObserver chat rect, stable views, `draftMentions` selector, gentler reheat; backdrop 30 fps with idle pause; float only on selected/running; timers cleaned. Open: offscreen culling; `patchItem` still remaps the array; **needs a hand check in the UI** (see log) |
| 17 | Accessibility and theming: keyboard/ARIA for bubbles, Strato tokens, z-index scale, light theme, `react-intl` decision (§7) | opus | ✅ | `2ca1de1` (theming), `e155513` (a11y). Tokens with dark/light/system (`R/theme.ts`), `--ink-faint` ≥ 4.5:1, `--z-*` scale, flattened shadows, shared metrics; bubbles get role/aria-label/roving tabindex/arrow-key nav, status glyphs, focus return, `useAutoFocus`, IME-safe Enter, `?` shortcuts overlay from one table. **`react-intl` must stay**: Strato's AppRoot imports it (peer dep). Open: `useThemePref()` returns `'system'` until item 8 adds `ui.theme`; screen-reader list view; hover card on focus; rebindable shortcuts |
| 18 | Cleanup: dead code, helper de-duplication (`normPath`), `oxlint-disable`, `noUncheckedIndexedAccess`, formatter (§8) | | ⬜ | |

## Log

- 2026-11-15: tracker created; batch 1 (items 1–5) dispatched.
- 2026-11-15: item 10 (CI) done in `b0e0b3d`; item 6 dispatched.
- 2026-11-15: items 1 and 5 done in `dcfc1c8` (310 tests pass); item 7 dispatched. Items 8 and 9 wait for the security agent, which is also editing `config.ts` and `handle.ts`.
- 2026-11-15: item 7 done in `f56ea48`; item 16 dispatched. Item 17 (a11y/theming) waits for 16, since both edit the canvas and CSS.
- 2026-11-15: item 6 done in `3cb9f2a`; items 2–4 done in `4a75ab7` (343 tests pass; dev smoke runs pass). Items 8 and 9 dispatched.
- 2026-11-15: item 9 done in `648e5af` (381 tests pass). Item 11 dispatched.
- 2026-11-15: item 16 done in `6685e39`, `1559633`; item 17 dispatched.
- 2026-11-15: item 11 done in `f74c1fe` (packaged Windows app starts); item 17 done in `2ca1de1`, `e155513` (437 tests pass). Item 14 dispatched.

## Check by hand in the UI

Agents can't drive the GUI, so these changes have passed typecheck and tests but nobody has looked at them yet:

- **Item 7:** the "!" sync badge and tooltip; the Undo toast after Remove / Delete.
- **Item 16:** bubbles and links follow the layout after boot, add/remove, filter, drag, Auto-arrange and Reset (no flash at 0,0); the hover card and inline actions follow their bubble and flip at the right edge; chat threads start at the chat box after a sidebar resize; popup rows are still clickable. Expected visible changes: idle bubbles no longer float, particles freeze after 60 s idle, the world layer isn't permanently promoted (check pan/zoom smoothness and text sharpness).
- **Item 17:** Tab into the canvas, arrow keys, Enter / Space / Esc, focus back on the bubble after the sidebar closes; the `?` overlay; the light theme (OS light mode) incl. Strato menus, diff, CodeMirror, mermaid, log ANSI colours; whether a ✓ on every green bubble is too busy; backdrop logo opacity in light mode.
- **Items 2–4:** a one-time confirm dialog when an agent starts in `bypassPermissions` / `dontAsk`; embedded GitHub/Jira/app pages still load.
