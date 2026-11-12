# Cortex — handoff guide

You are picking up **Cortex**, a single-page developer cockpit. Read this file top to bottom once before changing anything. It tells you what exists, how it is wired, and exactly what to do next.

## 1. Where things stand

**Done**

- The complete UI: sidebar of work cards, and a main view for chat, ticket, Claude sessions, PR review, build, app preview and todos.
- A **service layer** (`src/services`) that hides every external tool behind an interface. Today every interface is implemented by a **mock**.
- The mocks answer in the **same formats the real tools print** (`gh` JSON, unified diff text, Jira issue JSON, Jenkins build JSON, Claude stream-json events). Mappers turn those formats into what the UI shows.
- Todos are real already: they are stored in the browser's `localStorage`.
- So are the **toolbox** (bookmarks, `#/toolbox`) and **projects** (`#/projects`): per repository its GitHub location, local checkout, start command, Jira links, a roadmap and Mermaid architecture diagrams. See section 6.8.
- Markdown everywhere goes through `src/components/Md.tsx`, which renders ```` ```mermaid ```` blocks as diagrams (`src/components/Mermaid.tsx`, mermaid is lazy-loaded).
- The composer autocompletes skills / slash commands after `/` (`ClaudeService.listSkills`, mocked).

**Not done — this is your job**

- There are no real implementations yet. Nothing calls `gh`, `acli`, `git`, `claude` or Jenkins.
- There is no backend. A browser cannot run command-line tools, so a small local server (the **bridge**, section 5) has to be built first.

## 2. Run and check

```sh
npm install
npm run dev        # http://localhost:5173
npx tsc -b         # typecheck — must print nothing
npm run build      # production build — must succeed
```

There are no automated tests. After a change, typecheck, then click through the affected flow in the browser. The flows worth checking are listed in section 8.

Deep links help: `#/` (chat), `#/todos`, `#/toolbox`, `#/projects/<id>/<tab>` with tab = `overview | work | roadmap | architecture`, `#/<workId>/<tab>` with tab = `ticket | agents | review | pipeline | preview`, for example `#/CTX-1423/review`.

## 3. How the code is organised

```
views + shell          what you see                      src/views, src/shell, src/components
      │  read state with hooks, call actions
      ▼
state/store.ts         the one in-memory state object
state/actions.ts       everything the UI can do
state/sync.ts          loading, refreshing, polling, Claude events
state/derive.ts        "what does this work need?" (card grouping, next action)
state/persist.ts       keeps a store slice in localStorage (todos, toolbox, projects)
state/toolbox.ts       bookmarks · state/projects.ts  projects, roadmap, diagrams
      │  call services, map the answers
      ▼
services/index.ts      picks the implementation of each service   ← you change this
services/types.ts      the interfaces and tool-shaped data types   ← the contract
services/mappers/      tool format → UI model (src/model/types.ts)
services/mock/         today's implementations
services/config.ts     repo names, Jira field ids, poll intervals
services/prompts.ts    the prompt each agent button sends to Claude
```

One action, end to end — "Create PR":

1. A view calls `createPr(workId)` from `state/actions.ts`.
2. The action calls `services.github.createPullRequest(...)` and `services.jira.transition(...)`.
3. The action calls `refreshWork(workId, ['pr', 'ci', 'ticket'])` from `state/sync.ts`.
4. `refreshWork` asks the services for fresh data, runs it through the mappers, and writes it to the store.
5. Because the new build is running, `sync.ts` keeps polling the CI service until it finishes.
6. Views re-render from the store.

### Rules — keep to these

1. **Views never import from `src/services`.** They use hooks from `state/store.ts` and functions from `state/actions.ts`.
2. **Actions never write tool data into the store.** They call a service, then `refreshWork`. (The one exception: `transitionTicket` shows the new status immediately and then refreshes.)
3. **Service implementations return the tool's own format**, exactly as typed in `services/types.ts`. Converting to the UI model is the mappers' job.
4. **Do not change `services/types.ts` to fit a mock.** If the real tool prints something different from what is typed there, the real tool wins: fix the type and the mapper.
5. **Site-specific values go in `services/config.ts`**, not inline.
6. UI is built with Dynatrace Strato. Check a component's props in `node_modules/@dynatrace/strato-components/<area>/**/*.d.ts` before using it. Colours come from Strato tokens only (works in light and dark theme).

## 4. What "plugging in a real tool" means

For each service you write one object that satisfies its interface, and swap it in `services/index.ts`:

```ts
// src/services/real/github.ts
import type { GitHubService } from '../types';
import { bridge } from './bridge';            // tiny fetch wrapper, see section 5

export const github: GitHubService = {
  getPullRequest: (repo, number) => bridge('github/getPullRequest', { repo, number }),
  // …one line per method
};
```

```ts
// src/services/index.ts
import { github } from './real/github';       // was: './mock/tools'
```

Services are independent. Replace them **one at a time**, and keep the others on mocks. Be aware that the mocks share one fake world: once GitHub is real and git is still mocked, the two will not agree with each other (the mock worktree's branch has no real PR). That is expected during the transition — check each service on its own screen.

## 5. The bridge (build this first)

The browser cannot spawn processes. Build a small Node server that runs the commands and returns their output.

**Recommended shape**

- A folder `server/` with one file per service, mirroring the interfaces in `services/types.ts`.
- One HTTP endpoint per service method: `POST /api/<service>/<method>` with the arguments as JSON, the result as JSON.
- One Server-Sent-Events (or WebSocket) endpoint for Claude's live events: `GET /api/claude/events`.
- In development, mount it into Vite (`server.proxy` in `vite.config.ts`, or a Vite plugin with `configureServer`). The frontend then just calls `/api/...`.

**Safety rules for the bridge — not optional**

- Listen on `127.0.0.1` only.
- Run commands with `execFile(command, [args])` / `spawn` with an argument array. **Never** build a shell string from input (ticket titles and comment bodies contain quotes and backticks).
- Expose named methods only. Do not build a generic "run this command" endpoint.
- Resolve repo names to checkout paths from a fixed table in the server's config; never accept a path from the browser without checking it is inside a known root.

## 6. Service by service

Each method's doc comment in `services/types.ts` names its command. The tables below add what you need to know. **"Verify" means: I wrote this from memory of the tool and did not run it — check with `--help` before relying on it.**

### 6.1 GitHub — `gh` CLI (do this one first)

`gh` must be logged in (`gh auth status`). Pass `--repo <owner>/<repo>`; the owner is `config.githubOwner`.

| Method | Command |
| --- | --- |
| `whoami` | `gh api user` → use `login` and `name` |
| `findPullRequest` | `gh pr list --repo R --head <branch> --state all --json number --limit 1` |
| `getPullRequest` | `gh pr view <n> --repo R --json <GH_PR_FIELDS>` (the constant is in `types.ts`) |
| `getDiff` | `gh pr diff <n> --repo R` → return stdout as a string |
| `getReviewThreads` | `gh api graphql` with the query below |
| `createPullRequest` | `gh pr create --repo R --head H --base B --title T --body BODY --draft` → prints the PR URL; take the number from its end |
| `markReady` | `gh pr ready <n> --repo R` |
| `merge` | `gh pr merge <n> --repo R --squash --delete-branch` |
| `submitReview` | `gh pr review <n> --repo R --approve` / `--request-changes --body …` / `--comment --body …` |
| `setThreadResolved` | GraphQL mutation `resolveReviewThread(input:{threadId})` / `unresolveReviewThread` |
| `addReviewComment` | GraphQL, see notes |
| `deleteReviewComment` | GraphQL mutation `deletePullRequestReviewComment(input:{id})` |

Review threads query:

```graphql
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved path line diffSide
          comments(first: 50) {
            nodes { id body createdAt author { login } pullRequestReview { state } }
          }
        }
      }
    }
  }
}
```

Run it with `gh api graphql -f query='…' -F owner=… -F repo=… -F number=…`. Map `pullRequestReview.state == "PENDING"` to the comment's `state: 'PENDING'`, everything else to `'SUBMITTED'`.

Notes:

- **Pending comments.** In the UI, comments on a PR I am reviewing stay "pending" until I finish the review. On GitHub that is a pending review: mutation `addPullRequestReviewThread` (new thread) or `addPullRequestReviewThreadReply` (reply) adds to my pending review, creating it if needed; `gh pr review` / `submitPullRequestReview` publishes it. For `pending: false` (comments on my own PR), add the comment and submit the review with event `COMMENT` right away. Verify the exact mutation inputs in the GitHub GraphQL docs.
- **Names.** `gh` returns logins; only `author` in `gh pr view` carries a `name`. The UI shows `name || login` (`displayName` in `mappers/github.ts`). "Is this me?" compares against `whoami`, so the same rule applies on both sides and it works either way.
- **Closed PRs.** The UI model has no "closed without merging" state; such PRs show as open. Add a state to `PrState` if that matters.
- **Rate.** `refreshWork` fetches PR, diff and threads together after every review action. Fine for `gh`; do not add more polling on top.

### 6.2 Git — plain `git`

The server needs a table `repo name → main checkout path`.

| Method | Command |
| --- | --- |
| `listWorktrees` | `git -C <checkout> worktree list --porcelain` → blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>`; strip `refs/heads/` |
| `addWorktree` | `git -C <checkout> fetch origin` then `git -C <checkout> worktree add -b <branch> <path> origin/<base>` |
| `status` | `git -C <path> rev-list --left-right --count origin/<base>...HEAD` → `"<behind>\t<ahead>"`; `git -C <path> status --porcelain` → count the lines |
| `rebase` | `git -C <path> fetch origin` then `git -C <path> rebase origin/<base>` — on conflict, abort (`git rebase --abort`) and return an error |

Notes: `config.worktreeRoot` is `~/wt`; expand `~` on the server. The UI matches a work item to its worktree by exact path (`WorkRef.worktreePath`), so return paths in the same form you were given.

### 6.3 Jira — `acli` (or the company wrapper)

| Method | Command (verify) |
| --- | --- |
| `myOpenIssues` | `acli jira workitem search --jql "<config.jira.backlogJql>" --json` |
| `getIssue` | `acli jira workitem view <KEY> --json --fields "*all"` |
| `transition` | `acli jira workitem transition --key <KEY> --status "<name>"` |
| `addComment` | `acli jira workitem comment create --key <KEY> --body "<text>"` |

Notes:

- **First step: capture real output.** Run the `view` command for one real ticket, save the JSON, and compare it with `JiraIssue` in `types.ts`. Adjust the type and `mappers/jira.ts` to what you actually get. The search command may return fewer fields per issue than `view`; if so, call `view` per key.
- **Custom field ids** (story points, sprint, acceptance criteria) differ per Jira site. Find them in the captured JSON and set them in `config.jira.fields`. If there is no acceptance-criteria field, the list in the UI is simply empty.
- **Rich text.** Descriptions and comments arrive either as a string or as ADF (a JSON tree). `richTextToMarkdown` in `mappers/jira.ts` handles both, but **the ADF path has never run against real data** — expect to fix details.
- **Status names.** The UI knows four statuses (`To Do`, `In Progress`, `In Review`, `Done`) and sends those names to `transition`. `mapStatus` maps real names onto the four by keyword. If the real workflow uses other names, add a table in `config.ts` for the outgoing direction.
- **Which repo a ticket belongs to** is guessed from a label equal to a repo name (`startWorkOnTicket` in `actions.ts`), else the first configured repo. Replace this with whatever rule fits (component, project key).

### 6.4 Claude — Claude Code headless

The UI consumes **stream-json events**. `mappers/claude.ts` (`applyClaudeEvent`) turns them into the transcript, the status and the "what is it doing" line. The mock emits the same events, so the UI side is already exercised.

| Method | What the bridge does |
| --- | --- |
| `start` | `spawn('claude', ['-p', prompt, '--session-id', id, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'], { cwd })`; parse stdout line by line as JSON; forward each object to the events endpoint with a `timestamp` added |
| `send` | same, with `--resume <id>` instead of `--session-id <id>` |
| `interrupt` | kill the child process, then emit `{ type: 'result', subtype: 'interrupted', is_error: false, session_id }` yourself |
| `getTranscript` | read `~/.claude/projects/<project folder>/<id>.jsonl`; return its `user` / `assistant` entries as events, plus `running` = whether a child process exists for the id |
| `subscribe` | an `EventSource` on the events endpoint |
| `listSkills` | read `name` / `description` from the front matter of `<cwd>/.claude/skills/*/SKILL.md` (project) and `~/.claude/skills/*/SKILL.md` (user), plus legacy `.claude/commands/*.md`, plus the built-in slash commands that work headless |

Notes:

- **Verify the flags** with `claude --help` (`--session-id`, `--include-partial-messages`, `--permission-mode`). The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, `query()`) yields the same message objects and is a good alternative to spawning the CLI.
- **Permissions.** A headless agent stops when it needs a permission it does not have. Decide per agent kind which `--permission-mode` / `--allowedTools` to pass (`kind` is in the start options for this purpose; e.g. plan agents: `--permission-mode plan`). Ask the user what they are comfortable with before allowing unattended edits and shell commands.
- **The user's prompt is not echoed** in live output. The app adds the user message to the transcript itself (`appendUserMessage` in `actions.ts`). Stored transcripts do contain user prompts; the reducer handles those (string `content`).
- **Event fields.** The reducer reads only what is typed in `ClaudeEvent`. Real events carry more fields; ignore them. With `--include-partial-messages`, real `stream_event`s include more event types than text deltas — filter to `content_block_delta` with `delta.type == 'text_delta'` in the bridge, or widen the type and ignore the rest in the reducer.
- **"Needs your input" is a heuristic**: a turn whose last assistant text ends with `?` marks the session as waiting for me (`applyClaudeEvent`, case `result`).
- **The plan** shown on the ticket tab is the `result` text of the latest plan session (`onClaudeEvent` in `sync.ts`).
- **Skills** feed the `/` autocomplete in the chat composer (`components/session/Composer.tsx`); `boot()` loads them once into `state.skills`, and a failure just means no popup. The `system`/`init` event also carries `slash_commands` and `skills` names, which is worth verifying as a cross-check (written from memory). Skills are read without a `cwd` at boot, so project skills only show up once the bridge is given one; per-work-item lists would need a `listSkills(worktreePath)` call in the agents view.
- **Which sessions exist** is Cortex's own knowledge (`SessionRef` in the workspace), not Claude's.
- **Prompts** live in `services/prompts.ts`. The mock ignores their wording; real Claude will not. Review them with the user.

### 6.5 CI — Jenkins

Start with **level 1** (no Jenkins credentials needed), add level 2 only if an API token is available.

**Level 1 — status from GitHub.** Jenkins reports to the PR as a check.

- `getBuild`: `gh pr checks <n> --repo R --json name,state,bucket,link,startedAt,completedAt`. Pick the Jenkins check (by name). Fill `JenkinsBuild` like this: `url` = `link`; `building` = bucket is `pending`; `result` = `SUCCESS` for `pass`, `FAILURE` for `fail`, `null` while pending; `timestamp` from `startedAt`; `number` parsed from the end of the link (or `0`); `stages: []`, `history: []`.
- With `stages` empty, the build tab shows the status and an "Open it in Jenkins" link instead of stages and logs. That layout works but is rough: the panel stretches to full height and the header shows "Duration 0s" (it sums stage durations). Tidy both when you get here.
- `trigger`: whatever re-runs CI without the API — commonly a PR comment (`gh pr comment <n> --body "<trigger phrase>"`) or an empty commit. Ask the user which their Jenkins listens to.
- No PR yet → no build (`undefined`).

**Level 2 — Jenkins REST API** (user + API token, basic auth).

- Stages: `GET <build url>/wfapi/describe` → `stages[]` with `id`, `name`, `status`, `durationMillis`.
- Stage log: `GET <build url>/execution/node/<stage id>/wfapi/log` → `text` (HTML-ish; strip tags).
- Tests: `GET <build url>/testReport/api/json` → `passCount`, `failCount`, `skipCount`.
- History: `GET <job url>/api/json?tree=builds[number,result,duration]`.
- Trigger: `POST <job url>/build`.
- `JenkinsStage.log` is inlined in the build object to keep the contract small. If fetching every log is too slow, add a `getStageLog` method and load on click.

The "Fix CI" agent's prompt includes the failing stage's log (`prompts.ts`). At level 1 there is no log; the prompt then only names the build, and Claude has to find the failure itself.

### 6.6 Dev server

`start` spawns the repo's dev command (for example `npm run dev -- --port <free port>`) in the worktree, collects stdout lines into `logs`, and reports `running` once the port answers. `url` is what the preview iframe loads. Keep one process per work item id; `stop` kills it.

Note: many apps refuse to render inside an iframe (`X-Frame-Options`, CSP). If the real app does, the preview needs a proxy in the bridge or an "open in new tab" fallback.

### 6.7 Workspace

Cortex's own state: which work is on the board (`WorkRef`) and which Claude sessions belong to it (`SessionRef`). The mock keeps it in memory, so **the board resets on reload**. Real: a JSON file (for example `~/.cortex/workspace.json`) read and written by the bridge. `load` and `save` are the whole interface.

### 6.8 Projects and toolbox

Both are Cortex's own data and live in `localStorage` (`cortex.projects.v1`, `cortex.toolbox.v1`; first run is seeded from `src/mock/seed/projects.ts`). No service is involved, so views call `state/projects.ts` and `state/toolbox.ts` directly.

- `Project.id` is the repo name that `WorkItem.repo` / `WorkRef.repo` carry. The list of repos is no longer in `config.ts`; `config` only holds the defaults for new projects.
- Already used by the app: the repo picker in "New work", ticket → repo matching (`projectForLabels`: Jira label), and worktree root + base branch in `createWorktree`.
- **Not used yet — wire these when the bridge exists:** `github.owner/repo` (real GitHubService), `localPath` (the bridge's repo → checkout table, section 5; the bridge must still validate paths), `startCommand` and `port` (DevServerService.start), `jira.projectKey` / `jira.ticketKeys`. `sync.ts` still reads `config.baseBranch` for status and PRs. Because the bridge needs this data server-side, move projects from localStorage to the workspace file at that point (`persistSlice` is the only place to change).
- The mocks only know the three seeded repos; a project you add in the UI can be configured but has no fake tool data behind it.
- Project "Work" tab: derived from the board and backlog, no extra service calls. Project-wide Jira / PR / CI lists need new service methods (`gh pr list`, a JQL search per project) once tools are real.

## 7. Suggested order of work

Do these in order. Each step ends with something you can see working.

1. **Bridge skeleton.** `server/` with one test endpoint, mounted into Vite. Check: `fetch('/api/ping')` in the browser console answers.
2. **Workspace** on a JSON file. Check: start an ad-hoc work item, reload, it is still there. (Its other data will be empty — the other services are still mocks that do not know it.)
3. **GitHub, read-only**: `whoami`, `findPullRequest`, `getPullRequest`, `getDiff`, `getReviewThreads`. Add a real PR to the workspace file as review work (`kind: 'review'`, `prNumber`, `repo`). Check: its diff and threads render on the PR tab.
4. **GitHub, write**: comments, resolve, submit review, ready, merge. Use a throwaway PR.
5. **Git.** Check: "Create worktree" creates a real worktree and the card shows the branch.
6. **Jira.** Capture real JSON first (6.3). Check: ticket tab renders; status change shows up in Jira.
7. **CI level 1.** Check: the card shows the build status of a real PR.
8. **Claude.** Start with a `chat` session in a scratch folder. Then one agent kind at a time, with the user deciding permissions.
9. **Dev server.**
10. Raise `config.poll` intervals to real-world values (10–15 s for CI) and add error handling (next section).

## 8. Known gaps

- **No error handling.** A service call that throws becomes an unhandled promise rejection and the UI shows nothing. Mocks never fail; real tools will. Add a try/catch in `busy()` and the plain actions in `actions.ts`, and show a Strato toast (`ToastContainer` in `@dynatrace/strato-components/notifications`).
- **No loading states per part.** Only the initial load shows a spinner. Real calls take seconds; consider a "refreshing" hint on the card.
- **No background refresh.** Data changes only after an action, during a running build or app start-up, and on Claude events. Somebody else's new review comment will not appear until something triggers `refreshWork`. Add a slow timer or a refresh button.
- **Boot loads everything in parallel.** Fine for six mocks; with real tools, load the board first and each card's details as they arrive.
- **Seeded "running" session.** The mock session on CTX-1431 says running but nothing drives it; it stays that way until stopped. It is there to show the running state.
- **Card height.** About four cards fit in a 1000 px window. A compact card variant has been discussed but not built.

Flows to click through after any change to state or services:

1. On CTX-1440: Create worktree → Plan → (Ticket tab shows the plan) → Implement → Create PR → build goes green → Mark ready.
2. On CTX-1423: Build tab → "Let Claude fix it" → new build passes.
3. On PR #482: add a line comment (pending) → Finish review → Approve.
4. On CTX-1398: Merge → Archive.
5. Chat: send a message in "Ask Cortex"; send one in a work session; Stop a running agent.
6. Preview: Launch app → Stop.
7. Todos: add from the card menu, tick on the card, reload — they persist.
8. Toolbox: add a link, edit, delete, reload.
9. Projects: edit a field and Save; Roadmap: add a milestone and items; Architecture: new diagram, edit source, preview updates.
10. Chat: type `/` in the composer, pick a skill with the arrow keys and Enter. CTX-1431 → Ticket → Plan shows a Mermaid diagram.

## 9. Practical notes

- **TypeScript is pinned to 5.9** and React to 18: Strato's `react-intl` peer dependency rejects TypeScript 7. Do not upgrade either without checking `npm install` still resolves.
- **Strato inputs have no `autoFocus`.** Use `src/components/AutoFocus.tsx`.
- **Menus and modals render in portals but their clicks still bubble through React.** A menu inside a clickable card needs a wrapper that stops propagation (see the `<span>` around `<Menu>` in `WorkCard.tsx`).
- **Console noise is expected:** "Missing get… function from web runtime" (Strato outside the Dynatrace platform) and a `defaultProps` warning from Strato's Markdown component.
- **Seed data** lives in `src/mock/seed` (tickets, PR diffs, build logs, transcripts, agent scripts). `src/services/mock/world.ts` assembles it; `serialize.ts` converts it to tool formats. You should not need to touch any of it.
- The repo is developed on Windows. Commands in this guide are tool invocations, not shell syntax — run them through `execFile`.
