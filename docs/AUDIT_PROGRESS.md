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
| 8 | `~/.cortex/config.json`; move machine prefs out of the workspace; configurable Jira fields, branch template, editor, records folder (§3) | | ⬜ | |
| 9 | Structured IPC errors; zod-validate `gh` and `acli` JSON (§4) | | ⬜ | |
| 10 | CI: GitHub Actions typecheck, lint, test (§9) | haiku | ✅ | `b0e0b3d`. Ubuntu + Windows matrix, `engines` added. Not yet run on GitHub (branch not pushed) |

## Before distribution

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 11 | Packaging: electron-builder, `asarUnpack` jira-mock, icon, signing, updates (§9) | | ⬜ | |
| 12 | First run: opt-in demo world; explicit "Jira not configured" state (§9) | | ⬜ | |
| 13 | Real-world runs: real Claude session, throwaway PR (§10) | — | ⏸ | Needs the user: real GitHub and Claude accounts |

## Ongoing: maintainability

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 14 | Kind-specific code into the module: `describe`, `cwdOf`, `sync`, `multiActions`; derive `KINDS`/`ItemSchema`; remove project→deployment import (§2.1) | | ⬜ | |
| 15 | Generate IPC forwarders; derive `CortexApi`; `CodeHost` interface (§2.2) | | ⬜ | |
| 16 | Canvas rendering: positions via refs; chat draft stops re-rendering canvas (§6) | opus | 🔄 | Also store fan-out, backdrop/float animation, uncleaned timers |
| 17 | Accessibility and theming: keyboard/ARIA for bubbles, Strato tokens, z-index scale, light theme, `react-intl` decision (§7) | | ⬜ | |
| 18 | Cleanup: dead code, helper de-duplication (`normPath`), `oxlint-disable`, `noUncheckedIndexedAccess`, formatter (§8) | | ⬜ | |

## Log

- 2026-11-15: tracker created; batch 1 (items 1–5) dispatched.
- 2026-11-15: item 10 (CI) done in `b0e0b3d`; item 6 dispatched.
- 2026-11-15: items 1 and 5 done in `dcfc1c8` (310 tests pass); item 7 dispatched. Items 8 and 9 wait for the security agent, which is also editing `config.ts` and `handle.ts`.
- 2026-11-15: item 7 done in `f56ea48`; item 16 dispatched. Item 17 (a11y/theming) waits for 16, since both edit the canvas and CSS.
