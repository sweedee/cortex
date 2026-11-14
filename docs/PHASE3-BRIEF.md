# Phase 3 brief: shared rules for the per-kind agents

Four agents build kind modules in parallel, each in its own git worktree based on `app` @ `8a4763a`.

## Setup
- Make sure your HEAD is at the tip of `app` (`git log -1 app`). Create your branch (name given in your task) from it.
- Fresh worktree: `npx npm@11.21.2 ci` (npm 11.3.0 crashes), then `node node_modules/electron/install.js`.
- New deps are allowed only if really needed: `npx npm@11.21.2 install`, exact pins, versions at least 2 weeks old.

## Read first
- `PROGRESS.md`: decisions, the kinds table (actions and sidebar per kind), the log.
- `docs/ARCHITECTURE.md`, especially "Kind registry", "Toolkit for kind modules", "Data hooks", "Integrations", and the hot-spot list.
- `src/renderer/src/components/viewers/README.md`: Markdown, DiffViewer, CodeEditor, WebPanel, LogView.
- An existing kind module, e.g. `src/renderer/src/kinds/project/`.

## Rules
1. **Stay inside your `kinds/<kind>/` folders.** Put Sidebar.tsx, actions, hooks and dialogs next to `index.tsx`.
2. **Hot-spot files** (`domain/schemas.ts`, `kinds/{types,registry,common,icons}`, `store.ts`, `sidebar/index.tsx`, `data/*`, `seed.ts`, `index.css`, `overlays/Dialogs.tsx`, `chat/ChatBox.tsx`, `src/main/**`, `src/shared/**`, `native.ts`):
   - Change them only when unavoidable, keep the change minimal and additive, and put it in its own commit whose message starts with `hotspot:`.
   - Optional data fields may be added to a kind's zod schema without a version bump. A required or incompatible field needs a migration; avoid that.
   - New skills used by AI actions go in the `SKILLS` list in `chat/ChatBox.tsx`, one line each.
   - A new IPC channel needs main + shared + preload + `native.ts` + a `data/*` op. Follow the ARCHITECTURE recipe, in a `hotspot:` commit.
3. **"AI" actions** only insert a skill: `skill(id, label, '<skill-name>')` from `kinds/common.tsx`. The skills don't have to exist. Use kebab-case names, e.g. `create-ticket`, `review-renovate`, `brainstorm`, `plan`, `grill`, `implement`, `rebase`, `review`, `address-review`.
   **"UI" actions** do the real thing through `openForm` / `runTask` / `data/*Ops` and invalidate queries.
4. **Remove the prototype placeholder** ("not implemented yet" toast) for every action you implement. Where a kind still uses a prototype dialog in `overlays/Dialogs.tsx`, switch it to your sidebar. Don't delete the dialog code: the orchestrator cleans it up after the merges.
5. **UI style:** flat, no glass or gradients, small radii, dark-first, colours from Strato tokens only. Check Strato component props in `node_modules/@dynatrace/strato-components/**/*.d.ts`. Reuse `sidebar/` sections and `SidebarTabs` (`wide: true` for webviews and diffs).
6. **Demo seed items have fake paths and repos.** Sidebars must degrade gracefully:
   - For a missing `baseDir` or a non-absolute path, show a hint ("Set the project's base checkout in Settings…").
   - For a failed query, show an inline error. Never crash and never leave a spinner running forever.
7. **Never run real-world side effects while testing.** That means no real PR create, merge or comment, no push, and no real Claude session (it costs tokens; use the fake CLI fixture). Read-only `gh` / `git` calls are fine.
8. **Tests (vitest):**
   - Pure helpers: action availability per state, mappers, form → op argument building.
   - `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` must pass.
   - Smoke run if useful: `CORTEX_SMOKE=1 CORTEX_USER_DATA=<temp> npm run dev`, which can save a screenshot with `CORTEX_SMOKE_SHOT=<png>`. Look at the screenshot.
9. **Commits:**
   - Commit in steps. The final commit message starts with `Phase 3<letter>:`.
   - Every commit message ends with these two lines:
     ```
     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     Claude-Session: https://claude.ai/code/session_01PTfWAo8VCeKzdPKH2DUXTE
     ```
   - Don't push. Don't edit PROGRESS.md or this brief. Add a short section for your kinds to `docs/ARCHITECTURE.md` under a heading `### Kind: <kind>`, appended at the end of the file to keep merges simple.
10. **Report back, concisely:**
    - Branch, final commit, worktree path.
    - Per kind: the actions implemented (UI or AI) and the sidebar contents.
    - Every `hotspot:` change.
    - Skills added.
    - What was verified, and how.
    - Gaps.
