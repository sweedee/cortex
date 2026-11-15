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
- **Preload** only forwards (sandboxed: `electron`, `shared/ipc.ts` and `shared/bridge.ts` only); its
  forwarders are generated from the channel map, never written by hand.
- **Renderer** reaches native only through `native.ts`, and integrations through `data/*` (hooks for reads,
  `*Ops` for writes that invalidate their queries). Import direction: `domain` ← `store` ← `kinds/common`,
  `sidebar` ← `kinds/<kind>` ← `kinds/registry` ← UI. Kind modules never import the registry or another kind
  (use `ctx.kind(k)`); kinds may import the pure `sync/mapping.ts` and `sync/checks.ts`. The store gets its kind
  info from `installKindInfo()` (main.tsx), never by importing the registry.
- A new IPC channel is one line in `invokeChannels` (`shared/ipc.ts`), its zod schema, its `handle()` in
  main, its browser-fallback entry in `native.ts` and usually a `data/*` hook or op. The preload and
  `CortexApi` follow by themselves; the compiler and `ipcContract.test.ts` flag anything missing. See
  "Adding a channel" in ARCHITECTURE.md; `gh:prEdit` is a compact example.
- Code-host calls (PRs, checks, runs, repo links) go through `codeHost(item.data.provider)`
  (`data/codehost.ts`), not `native.gh` or hard-coded GitHub URLs.

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
  (`logic.ts` / `model.ts`, unit-tested), `sync.ts` (background refresh jobs) and `live.ts` (process push
  events) when it has them. Generic code never names a kind: what differs per kind is a `KindModule` hook
  (`describe`, `cwdOf`, `sync`, `live`, `multiActions`, `projectSection`, `addable.linkLabel`, …).
- **Adding a kind** touches its own folder plus two shared lines:
  1. `domain/schemas.ts`: the data schema and one `DATA_SCHEMAS` entry (everything else is derived);
  2. `kinds/registry.ts`: the `MODULES` entry (typecheck fails without it; `describe` is required);
  3. a fake-world item in `testing/fakeWorld.ts` (the registry test fails without one).
  Optional: an icon in `kinds/icons.tsx`, new link labels in `domain/links.ts`, a demo item in `seed.ts`.
  Details in "How to add a kind" in ARCHITECTURE.md.
- Links use a label from `domain/links.ts` (`LinkLabel`; document `from` / `to` kinds there).
- **AI** actions only insert a skill into the chat box. **UI** actions do the real thing with `openForm`,
  `runTask` and `data/*Ops`, and update the item through the store (`patchData`, `addItem`, `archive`).
- The first-run world is empty and the optional demo world (`seed.ts`) is made up (`unknown/demo`, no paths); unit tests use the fake world
  in `testing/fakeWorld.ts`. Items without a real checkout or repo (fake repos, unset or `~/…` paths) still
  happen: actions that need one are disabled with a reason;
  sidebars show a hint ("Set the project's base checkout in Settings…") or an inline error. Never crash and
  never leave a spinner running.
- Colours, shadows and z-index come from the tokens at the top of `index.css` (dark in `:root`, light under
  `[data-theme='light']`, the `--z-*` scale); component rules never use raw hex/rgba (`ui/contrast.test.ts`
  checks this and the text contrast). Sizes shared by TS and CSS live in `ui/metrics.ts`. Keyboard shortcuts
  live in one table, `ui/shortcuts.ts` (the canvas handler and the `?` overlay both read it). New
  focusable things need a label and a visible `:focus-visible` style.
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
