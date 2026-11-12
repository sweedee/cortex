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
state/notify.ts        what deserves a notification (pure: before, after → notices)
state/notifications.ts the notification list (persisted), mute / dedupe, desktop opt-in
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

1. A view opens the create dialog (`openCreatePrDialog(workId)` — the open dialog lives in `state.dialog`, rendered once by `shell/CreatePrDialog.tsx`); on submit it calls `createPr(workId, input)` from `state/actions.ts`.
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
| `listPullRequests` | `gh pr list --repo R --author "<config.renovate.author>" --state open --limit 100 --json number,title,headRefName,author,labels,updatedAt,statusCheckRollup,reviewDecision` (`GH_PR_LIST_FIELDS`); `author` is optional, `state` is `open \| closed \| merged \| all`. Used for the Renovate list (see 6.4 and 6.8) |
| `getPullRequest` | `gh pr view <n> --repo R --json <GH_PR_FIELDS>` (the constant is in `types.ts`) |
| `getDiff` | `gh pr diff <n> --repo R` → return stdout as a string |
| `getReviewThreads` | `gh api graphql` with the query below |
| `createPullRequest` | `gh pr create --repo R --head H --base B --title T --body BODY [--draft] [--reviewer <login>]…` → prints the PR URL; take the number from its end. `B` is the head branch of another PR for a stacked PR |
| `setBase` | `gh pr edit <n> --repo R --base <base>` |
| `requestAiReview` | `gh pr comment <n> --repo R --body "<config.aiReview.triggerComment>"` (e.g. `@claude review`); the bot `config.aiReview.botLogin` answers later |
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
- **AI review.** The mock shows the bot as a *pending reviewer* from the moment it is asked until it posts its review (`reviewers[].isBot`, set by the mapper when the login equals `config.aiReview.botLogin`; the UI disables the button while it is pending and `sync.ts` polls the PR, bounded by `config.poll.aiReviewTimeoutMs`). Real GitHub does **not** add a bot to `reviewRequests` when it is triggered by a comment. Decide how to derive "pending": e.g. a trigger comment (`gh pr view --json comments`) newer than the bot's latest review in `latestReviews`. The bot's inline comments arrive through the normal review-thread query (author = the bot login). Verify the trigger phrase and bot login with whoever runs the bot.
- **Stacked PRs.** A PR is stacked when its base branch is the head branch of another PR on the board (`parentOf` / `childrenOf` in `state/derive.ts`, matched by repo + branch names — no extra GitHub call). Not "ready to merge" while the parent is unmerged; once the parent is merged the child shows **Retarget to <base>** (`setBase`, action `retargetPr`). `gh pr merge --delete-branch` of the parent may make GitHub retarget children itself (the mock does not; verify) — in that case the child's PR already targets the default branch and the stack disappears on its own. A parent that is not on the board (archived) is shown as a plain branch name and does not block anything. `WorkRef.baseBranch` is the parent branch of stacked work: it is what `sync.ts` compares the worktree with and what Rebase rebases onto; `createPr` sets it when the chosen base is not the project default, `retargetPr` clears it. Caveat: after the parent was *squash*-merged, `git rebase origin/main` on the child replays the parent's commits and conflicts; the right command is `git rebase --onto origin/<default> <old parent branch>` — not implemented.
- **Renovate PRs.** `listPullRequests` returns `GhPrListItem`s; `mapRenovatePr` (`mappers/github.ts`) turns them into `RenovatePr`: the update type comes from a `major` / `minor` / `patch` label, else the `renovate/major-…` branch topic, else a title ending in `to v8` (no minor part = major), else `unknown` (shown as a neutral "update" chip) - **check what your Renovate config really puts on its PRs** (labels, branch prefix) and adjust `updateTypeOf`. The CI state is rolled up from `statusCheckRollup` (`rollupChecks`: any failed check = failed, anything unfinished = pending). **Verify** the `--author` form for the bot (`app/renovate` is what `gh` prints for GitHub Apps; some `gh` versions want `--author "app/renovate"`, some `--search "author:app/renovate"`) and the exact `statusCheckRollup` field names (typed from memory in `GhStatusCheck`). `config.renovate.author` holds the login.
- **Closed PRs.** The UI model has no "closed without merging" state; such PRs show as open. Add a state to `PrState` if that matters.
- **Rate.** `refreshWork` fetches PR, diff and threads together after every review action. Fine for `gh`; do not add more polling on top.

### 6.2 Git — plain `git`

The server needs a table `repo name → main checkout path`.

| Method | Command |
| --- | --- |
| `listWorktrees` | `git -C <checkout> worktree list --porcelain` → blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>`; strip `refs/heads/` |
| `addWorktree` | `git -C <checkout> fetch origin` then `git -C <checkout> worktree add -b <branch> <path> origin/<base>` |
| `status` | `git -C <path> rev-list --left-right --count origin/<base>...HEAD` → `"<behind>\t<ahead>"`; `git -C <path> status --porcelain` → count the lines |
| `rebase` | `git -C <path> fetch origin` then `git -C <path> rebase origin/<base>` — on conflict, abort (`git rebase --abort`) and return an error. Then `git -C <path> push --force-with-lease` if the branch has a PR (the UI expects CI to rebuild after a rebase; the mock starts a new build). `base` is the parent branch for stacked work |

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
| `start` | `spawn('claude', ['-p', prompt, '--session-id', id, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model, '--effort', effort], { cwd })`; parse stdout line by line as JSON; forward each object to the events endpoint with a `timestamp` added |
| `send` | same, with `--resume <id>` instead of `--session-id <id>`; `model` / `effort` come from the options argument and may differ from the previous turn |
| `answerQuestion` | resolves the parked `canUseTool` promise of that `AskUserQuestion` (see "Questions" below) |
| `interrupt` | kill the child process (and drop a parked question), then emit `{ type: 'result', subtype: 'interrupted', is_error: false, session_id }` yourself |
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

**Project sessions (the Renovate review).** Sessions normally belong to a work item (`workId`) or are the global chat (`workId` null, id `GLOBAL_SESSION_ID`). The agent kind `renovate` belongs to a *project*: `SessionRef.projectId` / `AgentSession.projectId` are set and `workId` is null. Everything that lists a work item's sessions filters by `workId`, the "Ask Cortex" chat is found by its fixed id, so project sessions show up in neither; the project page's "Dependency updates" section (Work tab, `views/projects/ProjectDependencies.tsx`) lists them (newest first, all runs selectable) and renders the selected one with the normal `Transcript` + `SessionComposer`. Start = `reviewRenovatePrs(projectId)` in `actions.ts` (one active run per project; model and effort come from the same remembered pick as any new session). The prompt is `renovatePrompt(project)` in `services/prompts.ts` - a real prompt for the real agent: review every open Renovate PR, read the release notes, check CI, approve and merge safe patch/minor updates with a green build, leave majors and red/pending builds with a comment saying what a human has to do, finish with a summary table. The bridge starts it with `cwd` = the project's `localPath` (main checkout, for its CLAUDE.md; the agent talks to GitHub through `gh --repo`, no worktree) and has to allow `gh pr list|view|checks|diff|review|comment|merge` plus web fetch for release notes, and `AskUserQuestion` (see Permissions). `ClaudeStartOptions.projectId` is only there for the mock. When the run ends (`result` event of a project session) `sync.ts` re-fetches the project's Renovate list (the PRs the agent merged are simply gone from `gh pr list --state open`) and raises the "Renovate review finished" notification: merged = PRs that left the list, "need you" = PRs still on it. The mock plays a script over the world's PRs (`mock/seed/renovate.ts`): `gh pr list/view/checks`, a WebFetch of the release notes, review + merge (really removing the PR from the mock world) for patch/minor with green CI, a comment for majors and red builds, a question when a build is still running ("wait for CI?"), and ends with a markdown table. Seeded per repo: five or six open PRs with patch, minor, major, pending and failing builds.

**Model and effort.** The composer has two small pickers (`Composer.tsx`); the lists, context window sizes and defaults are in `config.ts` (`CLAUDE_MODELS`, `EFFORT_LEVELS`, `CLAUDE_DEFAULTS`). They are per session, editable between turns (disabled while it runs or asks), stored on `AgentSession.model` / `.effort`, passed as `ClaudeStartOptions` / `ClaudeSendOptions` and remembered in `localStorage` (`cortex.claude.choice.v1`) as the default of the next new session. Flags: `--model <id>` and `--effort <level>`. **Verify `--effort` with `claude --help`**: I wrote the flag from memory (the Agent SDK may take it as an option instead; if the CLI has no such flag, map it to whatever the installed version offers, e.g. a thinking budget). The real `system`/`init` event reports the model actually used, and the reducer shows it. Real context windows can differ from `config.ts` (e.g. 1M variants): fix the table.

**Usage and the status line.** `StatusLine.tsx` shows model, effort, context bar, cost, cache read / write (+ hit rate), turns and last turn's duration. The reducer (`mappers/claude.ts`) fills `AgentSession.usage`: from every `assistant` event's `message.usage` (context used = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of the **latest** message; token and cache totals add up), from `result` events `total_cost_usd`, `num_turns` (summed over turns) and `duration_ms` (last turn). The bar turns warning at 80 % and critical at 95 %. Things to **verify** against real output:
- whether `total_cost_usd` / `num_turns` of a `result` are per invocation (what the reducer assumes: they are summed) or session totals (then replace instead of add);
- whether the CLI emits one `assistant` event per content block with the same `message.id` and repeated usage (the reducer skips totals of a repeated `message.id`, context is replaced either way);
- transcripts on disk (`.jsonl`) contain no `result` lines, so after a reload the bridge has to synthesise cost / turns / duration itself (the mock does this for the seeded sessions) or the status line shows context and cache only.

**Questions (`AskUserQuestion`).** Claude Code's tool arrives as a `tool_use` block named `AskUserQuestion` with `input.questions[] = { question, header, multiSelect, options[] = { label, description } }`. The reducer turns it into a tool message with `questions`; `Transcript` renders those as `QuestionCard` (single / multi select, always an "Other…" free-text choice, one Submit for all questions) and, once answered, as a collapsed question → answer summary. While it is open the session is `status: 'waiting'`, `activity: 'Has a question for you'`, so the work card, digest and sidebar treat it as "waiting for you", and the composer says an answer is expected. Typing a message instead is allowed: `sendMessage` (`actions.ts`) sees the open question and sends the text as the answer to the first question (others: "(skipped)"). Stop works with a question open (the card then reads "No answer").

The real bridge (**verify everything here against the SDK docs**): a headless run cannot ask a human, so it asks through the permission mechanism. With the Agent SDK pass `canUseTool(toolName, input)`; for `AskUserQuestion` do not answer at once, park the promise under the `tool_use` id and tell the browser through the events endpoint (the `assistant` event with the `tool_use` block already does that). `answerQuestion(sessionId, toolUseId, answers)` resolves the promise with `{ behavior: 'allow', updatedInput: { questions, answers } }`, after which Claude writes the `tool_result` itself and carries on. (With the bare CLI the equivalent is an MCP server passed as `--permission-prompt-tool`.) The `tool_result` text is expected to read `User has answered your questions: "<question>"="<answer>", …`; `parseAnswers` in the mapper reads exactly that, and the mock produces it (`askResultContent` in `mock/serialize.ts`) - fix both if real output differs. `interrupt` must reject the parked promise and kill the process.

**Permission requests are not handled anywhere** (grep for `permission` finds nothing in `src`): a real agent that needs a tool it is not allowed to use simply fails or stops (see Permissions above). They would slot into the same mechanism: `canUseTool` is called for every tool that is not pre-approved, so the bridge parks the promise exactly as for questions and the browser needs (1) a pending-permission event or tool message (tool name + input, e.g. "Claude wants to run `npm test`"), (2) a card with Allow / Allow always / Deny that calls a new `ClaudeService.answerPermission(sessionId, toolUseId, decision)`, which resolves with `{ behavior: 'allow', updatedInput }` or `{ behavior: 'deny', message }`, (3) the same `waiting` + activity status ("Wants to run Bash …"). `openQuestion` in `model/session.ts` would become "open request" with a kind. "Allow always" maps to the SDK's permission update / `--allowedTools` for later turns.

**Mock extras.** The plan agent asks two questions mid-run (approach: single choice; extras: multi-select) and its plan ends with a "Decisions" section reflecting the answers; the seeded CTX-1431 plan shows an answered question. In the global "Ask Cortex" chat any message containing *choose*, *decide*, *pick* or *prioritise* (e.g. "Help me choose what to do first") makes the mock ask a question first. The mock emits `system`/`init` on every turn, usage that grows with the context and costs that depend on the model (Fable dearest, Haiku cheapest; invented prices).

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
- Project "Work" tab: "In flight" and "Backlog" are derived from the board and backlog, no extra service calls. The **"Dependency updates"** section between them is the exception: the project's open Renovate PRs (`state.renovate[projectId]`, loaded by `loadRenovatePrs` when the section mounts and after each agent run; deliberately not part of `state.work`, it is project data) and the "Review Renovate PRs" button (disabled while there are none or a run is active). I put it on the Work tab rather than Overview because Overview is a settings form and this is "what is going on in the repo"; moving it is a one-line change in `ProjectWork.tsx`. Project-wide Jira / PR / CI lists need new service methods (`gh pr list`, a JQL search per project) once tools are real.

### 6.9 Notifications

Cortex tells you when something concerns you: a bell with an unread badge in the sidebar header (panel: newest first, grouped Today / Yesterday / Earlier, click = go there and mark read, "Mark all read", "Clear", opt-in desktop notifications), plus a transient Strato toast for each new one (clickable "Open"; at most two per burst, the rest is one "N more" toast).

- **Where detection lives:** `state/notify.ts`, pure functions only. `diffWork(before, after, me)` for build and PR transitions, `diffSession(before, after, subject)` for Claude, `renovateFinished(...)`, and `isInView(notice, view, sessions)`. `sync.ts` calls them at the two places where data enters the store (`refreshWork` after writing a re-fetched work item, `onClaudeEvent` after applying an event) and passes the result to `pushNotices` (`state/notifications.ts`). Only **transitions** count: the first load never notifies, and the same state seen again on the next refresh does not either.
- **Which transitions:** build failed (new failed build, names the failing stage); build passed after a failed one (the build before it, from `Pipeline.history`, or the one we just saw, was red); a reviewer approved / requested changes on **my** PR (per reviewer, so "Jonas approved" even when the PR as a whole is still blocked; a verdict with new comments from the same person is folded into one notice); new comments from someone else (the AI reviewer's review is one "AI review is in" notice with the comment count); PR merged; review requested from me (new review work on the board, or my pending review again); Claude needs input (open `AskUserQuestion` card, or a turn that ended with a question); Claude finished a run (agents, not chat replies); Claude run failed; Renovate review finished. Not notified on purpose: my own comments, my own verdicts, Stop (interrupted).
- **What is left out:** (1) whatever is on screen right now: the browser tab is visible and the notice's tab is open (PR events on the PR tab, builds on the Build tab, a Claude notice when that very session is the one shown, the project's Work tab for the Renovate run, the Ask Cortex chat); (2) the direct result of my own click: `muteNotifications(workId, kinds)` is called by `mergePr` (silences "merged") and `submitReview` (silences verdicts and comments) for 45 s - add a call when you add an action whose immediate result would echo back; (3) duplicates within 60 s (a stale refresh racing a newer one).
- **State:** `notifications` in the store (`Notice` + id, time, read flag), persisted in `cortex.notifications.v1`, capped at 100. A notice carries its target (`workId` + `tab` + `sessionId`, or `projectId` + `projectTab`, or neither = Ask Cortex chat); `openNotification(id)` in `actions.ts` navigates and marks it read. Toasts and desktop notifications come from `shell/NotificationToasts.tsx`, which announces only ids added while the app runs (restored ones are not repeated).
- **Desktop notifications:** off by default. The switch in the panel calls `Notification.requestPermission()` only when turned on, the choice is stored in `cortex.notifications.desktop.v1`, they are only fired while `document.hasFocus()` is false, clicking one focuses the window and opens the target. Where the API is missing the switch is not rendered; where fire fails (e.g. a browser that only allows them through a service worker) nothing happens.
- **Background refresh (what makes it work):** `sync.ts` re-fetches PR and build of every work item (`refreshBoard`) every `config.poll.boardMs`, paused while the tab is hidden (and once more as soon as it becomes visible again), skipping items that are already being polled (a running build, an app starting, the AI review) and merged PRs. It also reloads the workspace and adopts new work (review requests added by someone else). Unchanged parts keep their object identity and nothing is written when nothing changed, so it does not re-render views. 8 s is mock-sized: with real `gh` calls (a PR refresh is three calls per item) use a minute or more, and see below.
- **How the real bridge would feed it:** nothing in the UI changes. Polling is what works today: the refresh above asks the services, whatever they return is diffed. With the bridge you can do better in two ways without touching `notify.ts`: (a) a cheaper poll (`gh pr list --json` for the whole repo, then fetch details only for PRs whose `updatedAt` changed), (b) push: GitHub webhooks (`pull_request_review`, `pull_request_review_comment`, `check_run`/`status`, `pull_request`) and Jenkins notifications arrive at the bridge, which tells the browser over the same SSE channel as the Claude events; the handler then just calls `refreshWork(workId, ['pr', 'ci'])` for the affected item and detection runs as before. New review requests need the bridge to add review work to the workspace file (e.g. `gh search prs --review-requested=@me`), the refresh adopts it. For Jenkins level 1 (no history) "build passed again" only fires when the failed build was the one the app last saw.
- **Mock world:** `services/mock/outside.ts` makes things happen on their own, all delays in `OUTSIDE_DELAYS`: ~20 s after load Jonas Becker approves #491; ~34 s after load Priya Raman asks for your review of a new PR in query-service (a card appears); after "Mark ready" on a PR a reviewer comments after ~12 s and approves after ~26 s. Builds, agents and questions already produce the rest.

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
- **Background refresh is blunt.** Every `config.poll.boardMs` the whole board is re-fetched (6.9). Fine for mocks; with real tools make it cheaper (list call + `updatedAt`) or push-driven, and consider a manual refresh button and an "offline / tool failed" hint (see "No error handling": a failing refresh is swallowed silently today).
- **Notifications:** nothing is deduplicated across reloads for events that happened while the app was closed (it starts from "now"); there is no "snooze" or per-kind setting; the Renovate list is only refreshed when the project page opens and after a run, not by the background refresh; project sessions are not cleaned up when a project is deleted; the review-request mock adds a card ~34 s after every page load.
- **Boot loads everything in parallel.** Fine for six mocks; with real tools, load the board first and each card's details as they arrive.
- **Seeded "running" session.** The mock session on CTX-1431 says running but nothing drives it; it stays that way until stopped. It is there to show the running state.
- **Card height.** About four cards fit in a 1000 px window. A compact card variant has been discussed but not built.

Flows to click through after any change to state or services:

1. On CTX-1440: Create worktree → Plan → answer its question card (pick an option, tick an extra, Submit; the plan afterwards ends with your decisions) → (Ticket tab shows the plan) → Implement → Create PR → build goes green → Mark ready.
2. On CTX-1423: Build tab → "Let Claude fix it" → new build passes.
3. On PR #482: add a line comment (pending) → Finish review → Approve.
4. On CTX-1398: Merge → Archive.
5. Chat: send a message in "Ask Cortex"; send one in a work session; Stop a running agent.
6. Preview: Launch app → Stop.
7. Todos: add from the card menu, tick on the card, reload — they persist.
8a. Create PR dialog: on CTX-1440 do flow 1 up to "Create PR" (the button opens the dialog; the card menu item and the "Create pull request" button on the PR tab of a work item without a PR open the same one). Check the prefilled title/description, the Edit/Preview toggle, the commit count and warnings, then "Create draft pull request".
8b. Stacked PRs: CTX-1450 (PR tab) shows `main ← #491 ← #493 (this)`, the links navigate, Merge is disabled with "Merge #491 first". New work in `ingest-gateway` → Create worktree → Create pull request… → pick the `feature/CTX-1398-…` base (hint says it is stacked) → create. Merge CTX-1398 → the new PR offers "Retarget to main" → click; the stack disappears.
8c. AI review: "Request AI review" on any open PR (PR tab header or card menu) → button reads "AI review requested", about 5 s later the bot's threads appear without any other click.
8d. Rebase: CTX-1423 PR tab shows "2 behind main" and **Rebase**; after it, "up to date" and a new build #5 runs.
8e. Notifications: load the app and stay on Ask Cortex: ~20 s later the bell shows 1, a toast "Jonas Becker approved #491" appears, the panel lists it; ~34 s later "Priya Raman asked for your review" and a new PR #488 card. Click a notification: you land on that work item's PR tab and it is read. On CTX-1423 → Fix CI, then open CTX-1431: "Claude finished" and "Build #5 passed" arrive while you look elsewhere (open the Build tab of CTX-1423 first and the build one stays silent). On CTX-1440 do flow 1 and stay on the Claude tab: no notification for what you watch; go to another item while the plan agent asks its question: "Claude needs your input". CTX-1440 → Mark ready, look elsewhere: ~12 s "Mila Novak commented", ~26 s "Mila Novak approved #…". Merge CTX-1398 yourself: no "merged" notification. Reload: the list and read state are still there, no toast is repeated. "Mark all read", "Clear" (empty state). Switch on "Desktop notifications": the browser asks, nothing is asked before.
8f. Renovate review: Projects → Console UI → Work → "Dependency updates" lists six open PRs (patch / minor / major chips, CI state). "Review Renovate PRs": the button shows "Reviewing…", the run appears below (gh pr list / view / checks, release notes, review, merge). It asks what to do with the PR whose build is still running; answer it. When it ends the list shrinks to the PRs that need you (#305 major, #306 red) and the summary table is the last message. Start it and open Todos meanwhile: a notification "Renovate review finished · 4 merged, 2 need you" arrives and leads back to the project page. Run it again (earlier run stays selectable above the transcript); with nothing left the button is disabled and says why. Ask Cortex and the work cards never show these sessions.
8. Toolbox: add a link, edit, delete, reload.
9. Projects: edit a field and Save; Roadmap: add a milestone and items; Architecture: new diagram, edit source, preview updates.
10. Chat: type `/` in the composer, pick a skill with the arrow keys and Enter. CTX-1431 → Ticket → Plan shows a Mermaid diagram.
11. Session harness: in Ask Cortex change model and effort in the composer, send "Help me choose what to do first" (a question card appears, status "waiting"), answer by option; repeat and answer with "Other…" and by typing into the composer; repeat and press Stop with the question open. Watch the status line (context bar, cost, cache, turns) grow with every turn and the model follow your pick. Launch a Plan agent and answer the two-question card (single + multi-select), also once with "Other…" and once with Stop. Pickers are disabled while the session runs or asks; the next new session starts with your last pick. Try a ~1000 px wide window: the composer hint and the secondary status figures drop out first.

## 9. Practical notes

- **Animations live in one file, `src/animations.css`**, imported by one line in `src/main.tsx`. Rules: short ease-out entrances and colour transitions only, `opacity`/`transform` (plus the two tiny progress bars' width), everything inside `prefers-reduced-motion: no-preference`. To turn them off, delete that import; the only other trace is a `data-fresh` attribute (via `isFresh` in `session/meta.tsx`) on the newest transcript entries, which does nothing without the stylesheet.
- **TypeScript is pinned to 5.9** and React to 18: Strato's `react-intl` peer dependency rejects TypeScript 7. Do not upgrade either without checking `npm install` still resolves.
- **Strato inputs have no `autoFocus`.** Use `src/components/AutoFocus.tsx`.
- **Menus and modals render in portals but their clicks still bubble through React.** A menu inside a clickable card needs a wrapper that stops propagation (see the `<span>` around `<Menu>` in `WorkCard.tsx`).
- **Console noise is expected:** "Missing get… function from web runtime" (Strato outside the Dynatrace platform) and a `defaultProps` warning from Strato's Markdown component.
- **Seed data** lives in `src/mock/seed` (tickets, PR diffs, build logs, transcripts, agent scripts). `src/services/mock/world.ts` assembles it; `serialize.ts` converts it to tool formats. You should not need to touch any of it.
- The repo is developed on Windows. Commands in this guide are tool invocations, not shell syntax — run them through `execFile`.
