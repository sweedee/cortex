# Cortex

UI prototype of an all-in-one developer cockpit: every piece of work in flight (usually a Jira ticket, sometimes a PR to review or an ad-hoc task) is a card in the sidebar, and the main view adapts to whatever you are doing with it — ticket, Claude sessions, PR review, build, app preview, todos.

No real Jira, GitHub, git, Jenkins or Claude calls are made yet: each tool sits behind a service interface that is currently implemented by a mock speaking the real tool's output format. Todos are real and stored in `localStorage`.

```sh
npm install
npm run dev      # http://localhost:5173
```

**Continuing the work? Read [HANDOFF.md](HANDOFF.md).** It covers the architecture, the rules, and how to plug in the real tools.

| Path | What |
| --- | --- |
| `src/model/types.ts` | The UI's domain model |
| `src/shell/`, `src/views/`, `src/components/` | Page shell, work card, and the main-view contexts |
| `src/state/` | Store, actions, sync with the services, derived "what needs me" logic, hash router, todos |
| `src/services/types.ts` | Service interfaces and tool-shaped data types — the contract for real implementations |
| `src/services/mappers/` | Tool output → domain model |
| `src/services/mock/` | Mock implementations and the fake world behind them |
| `src/mock/seed/` | Seed content: tickets, PR diffs, build logs, transcripts |
| `public/preview/` | The fake "application under development" shown in the preview iframe |

Built with [Dynatrace Strato](https://developer.dynatrace.com/design/about-strato-design-system/).
