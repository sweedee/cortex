# Cortex

UI prototype of an all-in-one developer cockpit: every piece of work in flight (usually a Jira ticket, sometimes a PR to review or an ad-hoc task) is a card in the sidebar, and the main view adapts to whatever you are doing with it.

Everything is mocked — no Jira, Git, Jenkins or Claude calls are made.

```sh
npm install
npm run dev      # http://localhost:5173
```

## Layout

| Path | What |
| --- | --- |
| `src/model/types.ts` | Domain model (work item, ticket, worktree, session, PR, pipeline, app) |
| `src/mock/` | Seed data and the scripts the simulator plays back |
| `src/state/store.ts` | Tiny external store + hooks |
| `src/state/actions.ts` | Everything the UI can do; simulates latency, agents and CI builds with timers |
| `src/state/derive.ts` | "What does this work need?" — sidebar grouping and each card's next-best action |
| `src/state/router.ts` | Hash routing: `#/<workId>/<tab>[/<sessionId>]`, `#/` is the global chat |
| `src/shell/` | Page shell, sidebar, work card, main-view header |
| `src/views/` | Main-view contexts: chat, ticket, Claude sessions, PR review, build, app preview |
| `public/preview/` | The fake "application under development" shown in the preview iframe |

UI is built with [Dynatrace Strato](https://developer.dynatrace.com/design/about-strato-design-system/) (`@dynatrace/strato-components`, `-icons`, `-design-tokens`). TypeScript is pinned to 5.x because `react-intl` (a Strato peer) does not accept 7.x yet.
