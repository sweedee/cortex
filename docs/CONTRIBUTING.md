# Contributing

How to change Cortex without breaking it. [ARCHITECTURE.md](ARCHITECTURE.md) explains how it works; this
file holds the rules.

## Setup

- `npm install` (if npm crashes with `reading 'edgesOut'`, use `npx npm@11.21.2 install`). In a fresh clone or
  worktree after `npm ci`: `node node_modules/electron/install.js`.
- New dependencies only when really needed: exact version pins, versions at least two weeks old.
- Before a commit: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` must pass.

## Layering

- **Main** (`src/main`) owns every side effect: processes, files, git, gh, Jira, Claude. Logic goes into
  `lib/` or `services/` with an injectable runner so it is testable in node.
- **Shared** (`src/shared`) is dependency-free: the IPC contract, request schemas, tool DTOs and pure mappers.
- **Preload** only forwards (sandboxed: `electron` and `shared/ipc.ts` types only).
- **Renderer** reaches native only through `native.ts`, and integrations through `data/*` (hooks for reads,
  `*Ops` for writes that invalidate their queries). Import direction: `domain` ← `store` ← `kinds/common`,
  `sidebar` ← `kinds/<kind>` ← `kinds/registry` ← UI. Kind modules never import the registry or another kind
  (use `ctx.kind(k)`); `sync/` may import a kind's pure helpers.
- A new IPC channel touches shared (type + schema), main (handler), preload, `native.ts` (fallback) and a
  `data/*` op: follow "Adding a channel" in ARCHITECTURE.md. `gh:prEdit` is a compact example.

## Hot spots

Shared files that many features touch. Keep changes there small and additive, ideally in their own commit:

`domain/schemas.ts`, `domain/migrations.ts`, `kinds/{types,registry,common,icons}`, `store.ts`,
`sidebar/index.tsx`, `data/*`, `sync/*`, `ui/*`, `seed.ts`, `index.css`, `chat/ChatBox.tsx`,
`src/shared/**`, `src/main/ipc/**`, `native.ts`, `debug.ts`, `src/main/smoke*.ts`.

- An **optional** field on a kind's data schema needs no migration. A required or incompatible change needs a
  workspace version bump, a `MIGRATIONS` step, a fixture of the old format and a test. Never edit an old step.
- Every skill an AI action inserts (`skill(id, label, 'name')`, kebab-case) gets a line in `SKILLS` in
  `chat/skills.ts` (and an icon in `kinds/icons.tsx` if a fitting one exists).

## Kinds and actions

- A kind lives entirely in `kinds/<kind>/`: `index.tsx` (module), `actions.tsx`, `Sidebar.tsx`, pure helpers
  (`logic.ts` / `model.ts`, unit-tested). See "How to add a kind" in ARCHITECTURE.md.
- **AI** actions only insert a skill into the chat box. **UI** actions do the real thing with `openForm`,
  `runTask` and `data/*Ops`, and update the item through the store (`patchData`, `addItem`, `archive`).
- The first-run demo world (`seed.ts`) is real (`sweedee/cortex-demo`, Jira CTX); unit tests use the fake world
  in `testing/fakeWorld.ts`. Items without a real checkout or repo (fake repos, unset or `~/…` paths) still
  happen: actions that need one are disabled with a reason;
  sidebars show a hint ("Set the project's base checkout in Settings…") or an inline error. Never crash and
  never leave a spinner running.
- UI style: flat, dark-first, small radii, no glass or gradients, colours from Strato tokens. Check Strato
  props in `node_modules/@dynatrace/strato-components/**/*.d.ts`. Reuse the `sidebar/` sections
  (`SidebarSection` with `actions`, `SidebarTabs` with `wide: true` for webviews and diffs) and
  `components/viewers`.

## Testing without side effects

- Unit tests (vitest, node): pure helpers, action availability per state, mappers, form → op arguments,
  services with a fake runner. `npm test`.
- **Never cause real-world side effects while testing**: no real PR create / merge / comment, no push to a
  real remote, no real Jira, no real (paid) Claude session. Read-only `gh` / `git` calls are fine.
  - Claude: `CORTEX_CLAUDE_BIN=<abs path>/src/main/services/__fixtures__/fake-claude.mjs`.
  - Jira: the app uses the real `acli` by default. Unit tests build `JiraService` with the mock
    (`CORTEX_JIRA_CLI: 'mock'`) or a replaying runner over `__fixtures__/acli/`; smoke runs use the mock unless
    `CORTEX_JIRA_CLI` is set. Never construct services with the default config in a test.
  - git push: point `origin` at a local bare repo (the repo smoke does this).
  - gh: `GH_HOST=smoke.invalid` makes every gh call fail locally instead of reaching GitHub.
- Always use a throw-away profile: `CORTEX_USER_DATA=<temp dir>`.

## Smoke harness

Headless runs that load the real app, drive it and quit (details and all variables in ARCHITECTURE.md →
Smoke runs):

```
# bridge probe + screenshot
CORTEX_SMOKE=1 CORTEX_USER_DATA=<tmp> CORTEX_SMOKE_SHOT=<tmp>/shot.png npm run dev

# agent harness + app flows (fake Claude)
CORTEX_SMOKE=1 CORTEX_SMOKE_E2E=1 CORTEX_CLAUDE_BIN=<abs>/src/main/services/__fixtures__/fake-claude.mjs CORTEX_USER_DATA=<tmp> npm run dev

# the real-repo click-through: checklist + screenshots
GH_HOST=smoke.invalid CORTEX_SMOKE=1 CORTEX_SMOKE_REPO=1 CORTEX_SMOKE_OUT=<tmp>/run \
  CORTEX_CLAUDE_BIN=<abs>/src/main/services/__fixtures__/fake-claude.mjs CORTEX_USER_DATA=<tmp>/profile npm run dev

# the built app: viewers under the production CSP
npm run build && CORTEX_SMOKE=1 CORTEX_SMOKE_GALLERY=1 CORTEX_USER_DATA=<tmp> npx electron-vite preview
```

Look at the screenshots, not only at the checklist. To drive a new flow, extend `src/main/smokeRepo.ts`: run
actions with `d.runAction(itemId, actionId)`, fill and submit forms with `d.forms.submit(values, title)`
(returns the validation / submit error or null), and read sidebars from the DOM.

## Commits

Commit in small steps with a message that says what changed and why. Don't push from automated runs.
