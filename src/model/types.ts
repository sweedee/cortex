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
    };

export interface AgentSession {
  id: string;
  /** null = the global, work-independent Cortex chat */
  workId: string | null;
  kind: AgentKind;
  title: string;
  status: SessionStatus;
  model: string;
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
  reviewers: { name: string; state: ReviewerState }[];
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

export interface ViewState {
  /** null = no work selected → main view is the global Cortex chat (or the todo list, see 'page') */
  workId: string | null;
  /** which global page to show while no work is selected; default is the chat */
  page?: 'todos';
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
  view: ViewState;
  /** in-flight quick actions, keyed `${workId}:${action}` (see isBusy in the store) */
  busy: Record<string, boolean>;
}
