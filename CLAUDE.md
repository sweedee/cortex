# Cortex

Single-page developer cockpit (Vite + React 18 + TypeScript, Dynatrace Strato UI). All external tools are mocked behind a service layer.

**Read `HANDOFF.md` before changing anything.** It explains the architecture, the rules, and the next steps.

Quick reference:

- Run: `npm run dev` (http://localhost:5173). Check: `npx tsc -b` must print nothing; `npm run build` must succeed. There are no tests — click through the flows in HANDOFF.md section 8.
- Views use `src/state/store.ts` hooks and `src/state/actions.ts` functions. Views never import from `src/services`.
- Actions call a service, then `refreshWork` (`src/state/sync.ts`). They do not write tool data into the store themselves.
- Service implementations return the real tool's format as typed in `src/services/types.ts`; `src/services/mappers` converts to the UI model in `src/model/types.ts`.
- Swap mock for real implementations in `src/services/index.ts`, one service at a time.
- Strato: check component props in `node_modules/@dynatrace/strato-components/<area>/**/*.d.ts`. Colours from Strato tokens only.
- Do not upgrade TypeScript (pinned 5.9) or React (18) without checking `npm install` still resolves.
