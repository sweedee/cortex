# cortex · canvas (experimental)

A single-canvas developer command center. Everything (projects, tickets, worktrees, agent sessions,
pull requests, CI builds, plan files) is a bubble; one chat box at the bottom drives the agents.

```
npm install
npm run dev
```

## Interactions

| | |
|---|---|
| Click / Shift-click | select / add to selection; quick actions appear under the bubble and above the chat box |
| Shift-drag on empty canvas | marquee select |
| Drag empty canvas / wheel | pan / zoom (around the cursor) |
| Drag a bubble | move it (moves the whole selection); it stays where you drop it until *Auto-arrange* |
| Double-click / Enter | run the bubble's primary action |
| Right-click canvas | add / import a bubble at that spot, fit, auto-arrange |
| Right-click bubble | all actions for it (or the selection) |
| `@` / `/` in the chat box | mention a bubble / insert a skill; mentioned bubbles light up and get a thread to the chat box |
| `/` or Ctrl+K, F, Esc, Del, Ctrl+A | focus chat, fit (selection), deselect, remove from canvas, select all |
| Legend (bottom left) | show/hide bubble types |
| Bell (top right) | notifications; click one to fly to its bubble |

Ring = status (segments for mixed states, e.g. approved but conflicting PR is half green, half yellow;
a moving comet means something is running). Dot at the top right = notification.

## Code map

- `src/model.ts`, `src/seed.ts` — item/link types and the mock world
- `src/actions.tsx` — quick actions per kind (most insert a skill into the chat box), sending a prompt
- `src/store.ts` — tiny global store; `src/layout.ts` — d3-force layout + camera API
- `src/canvas/*` — canvas, bubbles, links, particles/logo backdrop, hover card, inline actions
- `src/chat/ChatBox.tsx` — chat box with @mention / /skill autocomplete
- `src/overlays/*` — HUD and dialogs (Strato components)
