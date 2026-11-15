# Audit implementation progress

Tracks the work on [AUDIT.md](AUDIT.md) §11. Item numbers match §11. Branch `app`; work starts from `971679f`.

Status: ⬜ open · 🔄 in progress · ✅ done · ⏸ deferred (needs a decision or outside access)

## Now: correctness, data safety, security

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 1 | Back up only a valid workspace file; timestamped backups; keep the corrupt file aside (§4 H4) | sonnet | 🔄 | |
| 2 | Lock down embedded pages: permission handlers, webview src/partition, navigation guards (§5) | opus | 🔄 | |
| 3 | Tighten IPC: drop `node`, whitelist env keys, restrict `fs:*` / `openPath` to registered roots (§5) | opus | 🔄 | |
| 4 | Strip dev code from packaged builds: smoke harness, dev env vars (§5) | opus | 🔄 | done together with 2 |
| 5 | Crash handlers, log file in `~/.cortex/logs`, try/catch around Claude `onEvent` (§4 M1) | sonnet | 🔄 | done together with 1 |

## Next: things users notice

| # | Item | Agent | Status | Commit / notes |
|---|---|---|---|---|
| 6 | Agent transcripts: incremental processing, memoized rows, length cap (§6) | | ⬜ | |
| 7 | Sync-failure badge per item; Undo for remove (§7) | | ⬜ | |
| 8 | `~/.cortex/config.json`; move machine prefs out of the workspace; configurable Jira fields, branch template, editor, records folder (§3) | | ⬜ | |
| 9 | Structured IPC errors; zod-validate `gh` and `acli` JSON (§4) | | ⬜ | |
| 10 | CI: GitHub Actions typecheck, lint, test (§9) | | ⬜ | |

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
| 16 | Canvas rendering: positions via refs; chat draft stops re-rendering canvas (§6) | | ⬜ | |
| 17 | Accessibility and theming: keyboard/ARIA for bubbles, Strato tokens, z-index scale, light theme, `react-intl` decision (§7) | | ⬜ | |
| 18 | Cleanup: dead code, helper de-duplication (`normPath`), `oxlint-disable`, `noUncheckedIndexedAccess`, formatter (§8) | | ⬜ | |

## Log

- 2026-11-15: tracker created; batch 1 (items 1–5) dispatched.
