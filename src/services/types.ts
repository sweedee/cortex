/**
 * Service layer contract.
 *
 * Every external tool Cortex talks to sits behind one of the interfaces below.
 * The data shapes ("DTOs") deliberately mirror what the real tool prints, so a
 * real implementation is mostly "run the command, JSON.parse stdout, return it".
 * Mapping DTOs to the UI's domain model happens in src/services/mappers.
 *
 * Each method documents the real command it stands for. See HANDOFF.md.
 */
import type { AgentKind, WorkKind } from '../model/types';

// =============================================================================
// Jira — Atlassian CLI (`acli jira workitem …`), output = Jira REST issue JSON
// =============================================================================

/** Atlassian Document Format node (Jira Cloud REST v3 rich text). */
export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
}

/** Rich text comes back as a plain/markdown string (REST v2, some wrappers) or as ADF (REST v3). */
export type JiraRichText = string | AdfNode | null;

export interface JiraUser {
  displayName: string;
  emailAddress?: string;
}

export interface JiraIssueRef {
  key: string;
  fields: { summary: string };
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    issuetype: { name: string };
    priority?: { name: string } | null;
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    labels?: string[];
    description?: JiraRichText;
    updated: string;
    /** the epic, for issues that have one */
    parent?: JiraIssueRef | null;
    issuelinks?: {
      type: { inward: string; outward: string };
      inwardIssue?: JiraIssueRef;
      outwardIssue?: JiraIssueRef;
    }[];
    comment?: {
      comments: { id: string; author: JiraUser; created: string; body: JiraRichText }[];
    };
    /** custom fields (story points, sprint, acceptance criteria) — ids are configured in services/config.ts */
    [customField: string]: unknown;
  };
}

export interface JiraService {
  /** `acli jira workitem search --jql "assignee = currentUser() AND statusCategory != Done" --json` */
  myOpenIssues(): Promise<JiraIssue[]>;
  /** `acli jira workitem view <KEY> --json --fields "*all"` */
  getIssue(key: string): Promise<JiraIssue>;
  /** `acli jira workitem transition --key <KEY> --status "<status>"` */
  transition(key: string, status: string): Promise<void>;
  /** `acli jira workitem comment create --key <KEY> --body "<body>"` */
  addComment(key: string, body: string): Promise<void>;
}

// =============================================================================
// GitHub — `gh` CLI
// =============================================================================

export interface GhUser {
  login: string;
  /** present on `author` in `gh pr view`; often missing elsewhere */
  name?: string;
}

/** `gh pr view <n> --json <GH_PR_FIELDS>` */
export interface GhPullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  body: string;
  url: string;
  author: GhUser;
  headRefName: string;
  baseRefName: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '';
  /** reviewers who have been asked but have not reviewed yet */
  reviewRequests: GhUser[];
  /** the latest review of everyone who has reviewed */
  latestReviews: { author: GhUser; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' }[];
  additions: number;
  deletions: number;
  updatedAt: string;
}

/** The `--json` field list that produces a GhPullRequest. */
export const GH_PR_FIELDS =
  'number,title,state,isDraft,body,url,author,headRefName,baseRefName,reviewDecision,reviewRequests,latestReviews,additions,deletions,updatedAt';

/**
 * One review thread. Not available through `gh pr view`; use
 * `gh api graphql` on `repository.pullRequest.reviewThreads` (query in HANDOFF.md).
 */
export interface GhReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  /** null when the thread is outdated */
  line: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  comments: {
    nodes: {
      id: string;
      author: GhUser;
      body: string;
      createdAt: string;
      /** PENDING = part of my not-yet-submitted review */
      state: 'PENDING' | 'SUBMITTED';
    }[];
  };
}

export type GhNewComment =
  | { threadId: string; body: string }
  | { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string };

export interface GitHubService {
  /** `gh api user` */
  whoami(): Promise<GhUser>;
  /** `gh pr list --repo <repo> --head <branch> --state all --json number --limit 1` */
  findPullRequest(repo: string, branch: string): Promise<number | undefined>;
  /** `gh pr view <n> --repo <repo> --json <GH_PR_FIELDS>` */
  getPullRequest(repo: string, number: number): Promise<GhPullRequest>;
  /** `gh pr diff <n> --repo <repo>` — raw unified diff text */
  getDiff(repo: string, number: number): Promise<string>;
  /** `gh api graphql` → reviewThreads */
  getReviewThreads(repo: string, number: number): Promise<GhReviewThread[]>;
  /** `gh pr create --repo <repo> --head <head> --base <base> --title … --body … [--draft]`, returns the PR number */
  createPullRequest(repo: string, pr: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<number>;
  /** `gh pr ready <n>` */
  markReady(repo: string, number: number): Promise<void>;
  /** `gh pr merge <n> --squash --delete-branch` */
  merge(repo: string, number: number): Promise<void>;
  /**
   * Adds a review comment (new thread or reply). With `pending: true` it goes into my pending
   * review (GraphQL `addPullRequestReviewThread` / `addPullRequestReviewComment` without submitting);
   * otherwise it is published right away.
   */
  addReviewComment(repo: string, number: number, comment: GhNewComment, pending: boolean): Promise<void>;
  /** GraphQL `deletePullRequestReviewComment` */
  deleteReviewComment(repo: string, number: number, commentId: string): Promise<void>;
  /** GraphQL `resolveReviewThread` / `unresolveReviewThread` */
  setThreadResolved(repo: string, number: number, threadId: string, resolved: boolean): Promise<void>;
  /** `gh pr review <n> --approve | --request-changes | --comment` — also publishes my pending comments */
  submitReview(repo: string, number: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'): Promise<void>;
}

// =============================================================================
// CI — Jenkins. Minimum: status via `gh pr checks`. Full detail: Jenkins REST API.
// =============================================================================

export type JenkinsStatus = 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' | 'NOT_EXECUTED' | 'ABORTED' | 'UNSTABLE';

/** One stage of `<build url>/wfapi/describe` (Pipeline Stage View plugin). */
export interface JenkinsStage {
  id: string;
  name: string;
  status: JenkinsStatus;
  durationMillis: number;
  /** `<build url>/execution/node/<id>/wfapi/log`, inlined here to keep the contract small */
  log?: string;
  /** from `<build url>/testReport/api/json`, attributed to the stage that ran the tests */
  tests?: { passCount: number; failCount: number; skipCount: number };
}

/**
 * A build as the UI needs it. A real implementation can start with the "checks only" level:
 * fill job/number/url/result/building from `gh pr checks <n> --json name,state,bucket,link,startedAt`
 * and leave `stages` and `history` empty — the build view degrades to a status + link.
 */
export interface JenkinsBuild {
  job: string;
  number: number;
  url: string;
  building: boolean;
  /** null while building */
  result: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | null;
  branch: string;
  commit: string;
  triggeredBy: string;
  /** start time, epoch millis */
  timestamp: number;
  stages: JenkinsStage[];
  /** previous builds of the same job, newest first */
  history: { number: number; result: 'SUCCESS' | 'FAILURE'; durationMillis: number }[];
}

export interface CiService {
  /** Latest build for a branch / PR, or undefined when nothing has been built yet. */
  getBuild(repo: string, ref: { branch: string; prNumber?: number }): Promise<JenkinsBuild | undefined>;
  /** Jenkins `POST <job url>/build` — or, without API access, whatever re-triggers CI (e.g. a PR comment). */
  trigger(repo: string, ref: { branch: string; prNumber?: number }): Promise<void>;
}

// =============================================================================
// Git — plain `git` in the repository / worktree
// =============================================================================

/** One entry of `git worktree list --porcelain`. */
export interface GitWorktree {
  path: string;
  /** short branch name, e.g. feature/CTX-1423-webhook-retry */
  branch: string;
  head: string;
}

export interface GitStatus {
  /** `git rev-list --left-right --count origin/<base>...HEAD` → behind, ahead */
  ahead: number;
  behind: number;
  /** number of lines of `git status --porcelain` */
  dirtyFiles: number;
}

export interface GitService {
  /** `git -C <repo checkout> worktree list --porcelain` */
  listWorktrees(repo: string): Promise<GitWorktree[]>;
  /** `git -C <repo checkout> worktree add -b <branch> <path> origin/<base>` */
  addWorktree(repo: string, worktree: { path: string; branch: string; base: string }): Promise<GitWorktree>;
  /** see GitStatus */
  status(path: string, base: string): Promise<GitStatus>;
  /** `git -C <path> fetch origin && git -C <path> rebase origin/<base>` */
  rebase(path: string, base: string): Promise<void>;
}

// =============================================================================
// Claude — Claude Code headless (`claude -p … --output-format stream-json --verbose`)
// or the Claude Agent SDK, which yields the same message shapes
// =============================================================================

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/** Token counts of one API call, as `message.usage` of an assistant event (real stream-json field names). */
export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Input of the `AskUserQuestion` tool (a `tool_use` block with that name). 1-4 questions, each with
 * 2-4 options; the UI always adds an "Other..." free-text choice itself (the real tool does too).
 */
export interface AskUserQuestionInput {
  questions: {
    question: string;
    /** very short label shown as a chip, e.g. "Approach" */
    header: string;
    multiSelect: boolean;
    options: { label: string; description?: string }[];
  }[];
}

/**
 * One line of stream-json output (subset Cortex uses). `timestamp` is not part of the CLI
 * output — the bridge should stamp events on arrival (session transcripts on disk do have it).
 */
export type ClaudeEvent = { timestamp?: string } & (
  /** emitted at the start of every invocation (`start` and every `send`), so `model` follows `--model` changes */
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; cwd?: string }
  /**
   * an assistant turn: text and/or tool calls. `usage` is that API call's token count; the context
   * window is full to `input + cache_read + cache_creation` of the latest one. The CLI may emit one
   * event per content block with the same `message.id` and repeated usage - hence `id` (the reducer
   * does not add the same id twice; verify against real output).
   */
  | { type: 'assistant'; session_id: string; message: { id?: string; content: ClaudeContentBlock[]; usage?: ClaudeUsage } }
  /** tool results — and, in stored transcripts only, the user's own prompts (string content) */
  | { type: 'user'; session_id: string; message: { content: ClaudeContentBlock[] | string } }
  /** partial text while the assistant is typing (`--include-partial-messages`) */
  | { type: 'stream_event'; session_id: string; event: { type: 'content_block_delta'; delta: { type: 'text_delta'; text: string } } }
  /**
   * end of a turn (= one invocation). `total_cost_usd`, `duration_ms`, `num_turns` and `usage` are the
   * real field names; I believe they describe this invocation only, so the reducer SUMS cost and
   * turns across results (verify - if the CLI reports session totals, change the reducer to replace).
   * Transcripts on disk contain no `result` lines: for those the bridge has to synthesise one.
   */
  | {
      type: 'result';
      session_id: string;
      subtype: 'success' | 'error_during_execution' | 'interrupted';
      is_error: boolean;
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      num_turns?: number;
      usage?: ClaudeUsage;
    }
);

export interface ClaudeStartOptions {
  /** id to give the session (`--session-id <uuid>`), so the caller knows it before the first event */
  sessionId: string;
  /** working directory: the worktree path, or undefined for the main checkout / global chat */
  cwd?: string;
  prompt: string;
  /** lets an implementation pick flags, e.g. `--permission-mode plan` for plan agents */
  kind: AgentKind;
  /** Cortex work item this session belongs to; null for the global chat. The CLI does not need it — the mock does. */
  workId: string | null;
  /** `--model <id>` (an alias like `opus` also works, Cortex sends full ids from `CLAUDE_MODELS`). Omitted: the CLI's default. */
  model?: string;
  /** `--effort <level>`, one of `EFFORT_LEVELS`. Verify with `claude --help` - written from memory. Omitted: the CLI's default. */
  effort?: string;
}

/** Per-turn settings of `send`; same flags as `ClaudeStartOptions`, may differ from the previous turn. */
export interface ClaudeSendOptions {
  /** `--model <id>` */
  model?: string;
  /** `--effort <level>` - verify with `claude --help` */
  effort?: string;
}

/** Answers to an `AskUserQuestion`: question text → chosen option label (several labels if multi-select) or free text. */
export type ClaudeAnswers = Record<string, string | string[]>;

export interface ClaudeService {
  /** Spawns `claude -p "<prompt>" --session-id <id> --output-format stream-json --verbose [--model <id>] [--effort <level>]` in `cwd`. */
  start(options: ClaudeStartOptions): Promise<void>;
  /** Next turn of an existing session: `claude -p "<text>" --resume <id> --output-format stream-json --verbose [--model <id>] [--effort <level>]`. */
  send(sessionId: string, text: string, options?: ClaudeSendOptions): Promise<void>;
  /**
   * Answers an open `AskUserQuestion` (`toolUseId` = id of its `tool_use` block). The session keeps
   * running afterwards: the answer shows up as the `tool_result` of that tool use, then Claude continues.
   * Real bridge: headless Claude asks through the SDK's `canUseTool(toolName, input)` callback (CLI:
   * the `--permission-prompt-tool` MCP tool) - the bridge parks that callback's promise per tool use id and
   * resolves it here, returning `{ behavior: 'allow', updatedInput: { questions, answers } }` (verify the
   * exact shape in the SDK docs). Claude then writes the tool result itself.
   */
  answerQuestion(sessionId: string, toolUseId: string, answers: ClaudeAnswers): Promise<void>;
  /** Kills the running process (SIGINT). Must emit a `result` event with subtype `interrupted`. Also cancels an open question. */
  interrupt(sessionId: string): Promise<void>;
  /**
   * Stored transcript of a session (`~/.claude/projects/<project>/<id>.jsonl`) plus whether a
   * process is currently running for it. Unknown id → empty transcript.
   */
  getTranscript(sessionId: string): Promise<{ events: ClaudeEvent[]; running: boolean }>;
  /** Live events of all sessions (WebSocket / SSE from the bridge). Returns an unsubscribe function. */
  subscribe(listener: (event: ClaudeEvent) => void): () => void;
}

// =============================================================================
// Dev server — the application under development, started from a worktree
// =============================================================================

export interface DevServerInfo {
  status: 'stopped' | 'starting' | 'running';
  port?: number;
  /** what to load in the preview iframe */
  url?: string;
  logs: string[];
}

export interface DevServerService {
  /** Spawns the repo's dev command (see config) in `cwd`. `id` is the work item id. */
  start(id: string, options: { repo: string; cwd?: string; title: string }): Promise<void>;
  stop(id: string): Promise<void>;
  get(id: string): Promise<DevServerInfo>;
}

// =============================================================================
// Workspace — Cortex's own state: which work is on the board, and which
// Claude sessions belong to it. Everything else is fetched from the tools above.
// =============================================================================

export interface WorkRef {
  id: string;
  kind: WorkKind;
  title: string;
  repo: string;
  ticketKey?: string;
  /** set once a worktree was created (or adopted) for this work */
  worktreePath?: string;
  /** set for review work; for own work the PR is found by branch */
  prNumber?: number;
  createdAt: string;
}

export interface SessionRef {
  id: string;
  workId: string | null;
  kind: AgentKind;
  title: string;
  startedAt: string;
}

export interface Workspace {
  work: WorkRef[];
  sessions: SessionRef[];
}

export interface WorkspaceService {
  /** Real: a JSON file (e.g. ~/.cortex/workspace.json) served by the bridge. */
  load(): Promise<Workspace>;
  save(workspace: Workspace): Promise<void>;
}

// =============================================================================

export interface Services {
  jira: JiraService;
  github: GitHubService;
  ci: CiService;
  git: GitService;
  claude: ClaudeService;
  devServer: DevServerService;
  workspace: WorkspaceService;
}
