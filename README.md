# cortex

A single-canvas developer command center. Everything (projects, tickets, worktrees, agent sessions,
pull requests, CI builds, plan files) is a bubble; one chat box at the bottom drives the agents.
It is an Electron desktop app (electron-vite, React 18, Dynatrace Strato UI).

## Run

```
npm install
npm run dev          # Electron app with hot reload (main, preload and renderer)
npm run dev:web      # renderer only in a browser; native calls use the fallback in native.ts
npm run build        # typecheck + bundle to out/
npm run preview      # run the built app
npm run typecheck    # tsc for the node (main/preload) and web (renderer) projects
npm run lint         # oxlint
npm test             # vitest (main in node, renderer logic)
```

Needs Node 22.12+ (or 24). If `npm install` fails with `Cannot read properties of null (reading 'edgesOut')`,
your npm is too old for vitest's peer set: `npx npm@11.21.2 install`.

Handy env vars: `CORTEX_USER_DATA=<dir>` uses a separate profile (workspace file, window state);
`CORTEX_SMOKE=1 npm run dev` calls a few bridge methods from inside the page, prints the results and quits.

The workspace (bubbles and links) is saved to `<userData>/workspace.json` (Windows:
`%APPDATA%\cortex\workspace.json`, previous version in `.bak`). Right-click the canvas →
*Reset workspace to demo data* to start over.

## Interactions

| | |
|---|---|
| Click / Shift-click | select / add to selection; quick actions appear under the bubble and above the chat box |
| Shift-drag on empty canvas | marquee select |
| Drag empty canvas / wheel | pan / zoom (around the cursor) |
| Drag a bubble | move it (moves the whole selection); it stays where you drop it until *Auto-arrange* |
| Double-click / Enter | run the bubble's primary action |
| Right-click canvas | add / import a bubble at that spot, fit, auto-arrange, reset to demo data |
| Right-click bubble | all actions for it (or the selection) |
| `@` / `/` in the chat box | mention a bubble / insert a skill; mentioned bubbles light up and get a thread to the chat box |
| `/` or Ctrl+K, F, Esc, Del, Ctrl+A | focus chat, fit (selection), deselect, remove from canvas, select all |
| Legend (bottom left) | show/hide bubble types |
| Bell (top right) | notifications; click one to fly to its bubble; desktop notifications and sound toggles |

Ring = status (segments for mixed states, e.g. approved but conflicting PR is half green, half yellow;
a moving comet means something is running). Dot at the top right = notification.

## Code map

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for processes, IPC channels and rules.

- `src/main/` — Electron main: window (`window.ts`), IPC handlers (`ipc/*`), node-side helpers (`lib/*`)
- `src/preload/` — exposes the typed bridge as `window.cortex`
- `src/shared/` — IPC contract (`ipc.ts`) and its zod request schemas (`schemas.ts`)
- `src/renderer/` — the UI (`index.html`, `src/`); static assets in `public/`
  - `native.ts` — the only way to native functionality (with a browser fallback)
  - `model.ts`, `seed.ts` — item/link types and the mock world
  - `actions.tsx` — quick actions per kind (most insert a skill into the chat box), sending a prompt
  - `store.ts` — tiny global store; `persist.ts` — workspace load / autosave; `layout.ts` — d3-force layout + camera API
  - `desktop.ts`, `sound.ts` — OS notifications and chimes for new notices
  - `canvas/*` — canvas, bubbles, links, particles/logo backdrop, hover card, inline actions
  - `chat/ChatBox.tsx` — chat box with @mention / /skill autocomplete
  - `overlays/*` — HUD and dialogs (Strato components)
