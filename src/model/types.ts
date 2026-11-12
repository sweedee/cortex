/**
 * Cortex domain model. The UI only knows these types; src/services maps tool output onto them.
 * A WorkItem is the unit the sidebar shows as a card; most of the time it
 * wraps a Jira ticket, but it can also be an ad-hoc task or a PR to review.
 */

export type WorkKind = 'ticket' | 'review' | 'adhoc';

export type TicketStatus = 'To Do' | 'In Progress' | 'In Review' | 'Done';
export type TicketType = 'Story' | 'Bug' | 'Task' | 'Spike';
export type TicketPriority = 'Blocker' | 'High' | 'Medium' | 'Low';

export interface TicketComment {
  id: string;
  author: string;
  at: string; // ISO timestamp
  bodyMd: string;
}

export interface Ticket {
  key: string;
  summary: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  assignee: string;
  reporter: string;
  epic?: string;
  sprint?: string;
  storyPoints?: number;
  labels: string[];
  descriptionMd: string;
  acceptanceCriteria: string[];
  comments: TicketComment[];
  links: { relation: string; key: string; summary: string }[];
  updatedAt: string;
}

export interface Worktree {
  repo: string;
  path: string;
  branch: string;
  baseBranch: string;
  ahead: number;
  behind: number;
  dirtyFiles: number;
}

// ---- Claude sessions -------------------------------------------------------

export type AgentKind = 'plan' | 'implement' | 'review' | 'fix-ci' | 'chat';
export type SessionStatus = 'running' | 'waiting' | 'done' | 'failed';

export type SessionMessage =
  | { id: string; role: 'user' | 'assistant'; at: string; text: string /* markdown */ }
  | {
      id: string;
      role: 'tool';
      at: string;
      tool: string; // e.g. Read, Edit, Bash, Grep
      summary: string; // one-liner, e.g. "src/dispatcher/retry.ts"
      detail?: string; // optional output / diff snippet (plain text)
      status: 'running' | 'ok' | 'error';
      /** AskUserQuestion only: the questions asked, and (once answered) question → answer text */
      questions?: AskQuestion[];
      answers?: Record<string, string>;
    };

/** One question of Claude's AskUserQuestion tool. */
export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
}

/** Token / cost figures of a session, accumulated from stream-json usage fields. */
export interface SessionUsage {
  /** context window in use: input + cache read + cache creation tokens of the latest assistant message */
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** total over all finished turns; 0 until the first turn ends */
  costUsd: number;
  /** finished turns (sum of `num_turns` of the results) */
  turns: number;
  /** wall time of the last finished turn */
  lastTurnMs?: number;
  /** id of the last assistant message counted: repeated events of one message are not added twice */
  lastMessageId?: string;
}

export interface AgentSession {
  id: string;
  /** null = the global, work-independent Cortex chat */
  workId: string | null;
  kind: AgentKind;
  title: string;
  status: SessionStatus;
  model: string;
  /** reasoning effort chosen for the next turn; undefined = the default */
  effort?: string;
  /** undefined until the first usage figures arrive */
  usage?: SessionUsage;
  startedAt: string;
  /** short "what it is doing right now" line shown on the work card */
  activity?: string;
  messages: SessionMessage[];
}

// ---- Pull requests ---------------------------------------------------------

export type PrState = 'draft' | 'open' | 'approved' | 'changes-requested' | 'merged';
export type ReviewerState = 'pending' | 'approved' | 'changes-requested' | 'commented';

export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  content: string;
}

export interface DiffHunk {
  header: string; // "@@ -12,7 +12,19 @@ export class Dispatcher"
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  language: string; // ts, tsx, java, yaml, ...
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface ReviewComment {
  id: string;
  author: string;
  at: string;
  body: string; // markdown
  /** authored by me but not yet submitted as part of a review */
  pending?: boolean;
}

export interface ReviewThread {
  id: string;
  filePath: string;
  /** line number on `side` the thread is anchored to */
  line: number;
  side: 'old' | 'new';
  resolved: boolean;
  comments: ReviewComment[];
}

export interface PullRequest {
  number: number;
  title: string;
  state: PrState;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  descriptionMd: string;
  /** `isBot`: the AI reviewer (`config.aiReview.botLogin`) */
  reviewers: { name: string; state: ReviewerState; isBot?: boolean }[];
  files: DiffFile[];
  threads: ReviewThread[];
  updatedAt: string;
  /** true when I am the reviewer rather than the author */
  reviewRequested?: boolean;
}

// ---- CI --------------------------------------------------------------------

export type StageStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

export interface PipelineStage {
  name: string;
  status: StageStatus;
  durationSec?: number;
  tests?: { passed: number; failed: number; skipped: number };
  /** console output for the stage */
  log: string;
}

export interface Pipeline {
  job: string; // jenkins job name
  /** link to the build in Jenkins */
  url?: string;
  buildNumber: number;
  status: 'queued' | 'running' | 'passed' | 'failed';
  branch: string;
  commit: string;
  triggeredBy: string;
  startedAt: string;
  stages: PipelineStage[];
  /** previous builds, newest first — for the history strip */
  history: { buildNumber: number; status: 'passed' | 'failed'; durationSec: number }[];
}

// ---- Local app -------------------------------------------------------------

export interface AppInstance {
  status: 'stopped' | 'starting' | 'running';
  url?: string;
  port?: number;
  logs: string[];
}

// ---- Work item -------------------------------------------------------------

export interface WorkItem {
  id: string;
  kind: WorkKind;
  title: string;
  repo: string;
  ticket?: Ticket;
  worktree?: Worktree;
  /** markdown implementation plan produced by a plan agent */
  planMd?: string;
  pr?: PullRequest;
  pipeline?: Pipeline;
  app: AppInstance;
  updatedAt: string;
}

/** Form values of the "Create pull request" dialog. */
export interface CreatePrInput {
  title: string;
  body: string;
  /** target branch; another work item's branch makes this a stacked PR */
  base: string;
  draft: boolean;
  /** GitHub logins */
  reviewers: string[];
}

/** Dialog that is open on top of the shell (kept in the store so any entry point can open it). */
export type Dialog = { kind: 'create-pr'; workId: string };

/** Tabs of the main view when a work item is selected. */
export type WorkTab = 'ticket' | 'agents' | 'review' | 'pipeline' | 'preview';

/** A note-to-self. Optionally attached to a work item. Persisted in localStorage. */
export interface Todo {
  id: string;
  text: string;
  done: boolean;
  workId?: string;
  createdAt: string;
  doneAt?: string;
}

// ---- Toolbox, projects, skills (Cortex's own data, persisted in localStorage) ----

/** A bookmark in the toolbox. */
export interface ToolboxLink {
  id: string;
  label: string;
  url: string;
  /** key into the icon registry (src/components/linkIcons.tsx); unknown key → generic link icon */
  icon: string;
  /** free-text section heading, e.g. "Observability" */
  group?: string;
  /** set → the link also shows on that project's overview */
  projectId?: string;
}

export type MilestoneStatus = 'planned' | 'active' | 'done';

export interface RoadmapItem {
  id: string;
  text: string;
  done: boolean;
  /** linked Jira ticket, e.g. CTX-1423 */
  ticketKey?: string;
}

export interface Milestone {
  id: string;
  title: string;
  /** free text: "Q1 2027", "2026-12-01", "Next" */
  target?: string;
  status: MilestoneStatus;
  items: RoadmapItem[];
}

export interface Diagram {
  id: string;
  title: string;
  /** Mermaid source */
  source: string;
  updatedAt: string;
}

/**
 * Where a repository lives and how to work with it. `id` is the short repo name that
 * WorkItem.repo / WorkRef.repo refer to.
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  github: { owner: string; repo: string };
  baseBranch: string;
  /** main checkout on this machine */
  localPath: string;
  /** new worktrees are created below this folder */
  worktreeRoot: string;
  /** how to start the app locally, e.g. "npm run dev" */
  startCommand: string;
  port?: number;
  jira: {
    projectKey: string;
    /** tickets carrying one of these labels belong to this project */
    labels: string[];
    /** tickets linked by hand (epics, long-running tickets) */
    ticketKeys: string[];
  };
  roadmap: Milestone[];
  diagrams: Diagram[];
}

export type ProjectTab = 'overview' | 'work' | 'roadmap' | 'architecture';

/** A Claude Code skill / slash command offered by the composer's "/" autocomplete. */
export interface Skill {
  name: string;
  description: string;
  source: 'project' | 'user' | 'builtin';
}

export type GlobalPage = 'todos' | 'toolbox' | 'projects';

export interface ViewState {
  /** null = no work selected → main view is the global Cortex chat (or a global page, see 'page') */
  workId: string | null;
  /** which global page to show while no work is selected; default is the chat */
  page?: GlobalPage;
  /** page 'projects': the open project and its tab */
  projectId?: string;
  projectTab?: ProjectTab;
  tab: WorkTab;
  /** which session is open in the agents tab */
  sessionId?: string;
}

export interface CortexState {
  /** false until the initial load from the services has finished */
  ready: boolean;
  me: string;
  work: WorkItem[];
  sessions: AgentSession[];
  /** assigned tickets that have not been turned into work yet */
  backlog: Ticket[];
  todos: Todo[];
  toolbox: ToolboxLink[];
  projects: Project[];
  /** skills / slash commands for the composer autocomplete */
  skills: Skill[];
  view: ViewState;
  dialog: Dialog | null;
  /** in-flight quick actions, keyed `${workId}:${action}` (see isBusy in the store) */
  busy: Record<string, boolean>;
}
