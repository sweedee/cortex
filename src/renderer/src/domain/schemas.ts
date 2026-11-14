/**
 * The persisted domain model, as zod schemas (types are inferred from them in `types.ts`).
 *
 * Everything on the canvas is an `Item` (a bubble): common fields plus a typed `data` per
 * `kind`. Items only cache what the canvas needs to draw the ring and the hover card;
 * live / large data (diffs, transcripts, full Jira issues, PR details) is fetched with
 * TanStack Query (`src/data/`) and never stored here.
 *
 * Changing a schema in a way old files can't satisfy? Bump `WORKSPACE_VERSION` and add a
 * migration in `migrations.ts`.
 */
import { z } from 'zod';

export const WORKSPACE_VERSION = 3;

// ---- shared vocabulary ---------------------------------------------------------------------

/** Colour family of a status ring segment / notice. `running` animates. */
export const ToneSchema = z.enum(['success', 'warning', 'critical', 'running', 'primary', 'neutral', 'pending']);

/** One slice of the status ring (derived, never stored on items). Weights are relative (default 1). */
export const SegmentSchema = z.object({ tone: ToneSchema, label: z.string(), weight: z.number().positive().optional() });

export const NoticeSchema = z.object({
  text: z.string(),
  tone: ToneSchema,
  /** when it was raised, epoch ms */
  at: z.number(),
  /** seen in the notifications menu or by selecting the bubble; the badge goes away */
  read: z.boolean().optional(),
});

export const PointSchema = z.object({ x: z.number(), y: z.number() });

export const KINDS = ['project', 'ticket', 'worktree', 'record', 'pr', 'agent', 'app', 'build', 'deployment', 'todo', 'testrun'] as const;
export const KindSchema = z.enum(KINDS);

/** Fields every item has, whatever its kind. */
const common = {
  id: z.string().min(1),
  /** what you type after @ in the chat box */
  handle: z.string().min(1),
  title: z.string(),
  /** the project this item belongs to; also the layout cluster it gravitates towards */
  projectId: z.string().optional(),
  /** completed or put away: hidden unless the filter shows archived items */
  archived: z.boolean().optional(),
  notice: NoticeSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** where the user dropped the bubble (pinned until "Auto-arrange"); unset = free layout */
  pos: PointSchema.optional(),
};

// ---- per-kind data -------------------------------------------------------------------------

const count = z.number().int().nonnegative();

/** Aggregated CI state of a branch / PR. */
export const CheckStateSchema = z.enum(['none', 'pending', 'success', 'failure']);
export const ChecksSchema = z.object({ state: CheckStateSchema, passed: count.optional(), failed: count.optional(), pending: count.optional() });

export const ProjectDataSchema = z.object({
  /** GitHub `owner/name` */
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name'),
  /** the main checkout; picked with a directory picker (unset until configured) */
  baseDir: z.string().optional(),
  /** where new worktrees go, e.g. `<baseDir>/../wt/<name>` */
  worktreesDir: z.string().optional(),
  defaultBranch: z.string(),
  /** e.g. `npm run dev`; runs in a shell (user configured) */
  startCommand: z.string().optional(),
  testCommand: z.string().optional(),
  /** cached for the ring; refreshed by the gh integration */
  stats: z.object({ mainChecks: CheckStateSchema.optional(), openPrs: count.optional(), renovatePrs: count.optional() }).optional(),
});

export const TicketDataSchema = z.object({
  /** Jira key, e.g. CTX-4821 */
  key: z.string(),
  /** Jira status name ("In Progress", "In Review", …) */
  status: z.string(),
  /** Jira status category: new = to do, indeterminate = in progress, done */
  statusCategory: z.enum(['new', 'indeterminate', 'done']),
  /** issue type: Story, Bug, Spike, … */
  type: z.string(),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  sprint: z.string().optional(),
  points: z.number().optional(),
  /** the git branch work happens on (set when a worktree is created) */
  branch: z.string().optional(),
});

export const GitStatsSchema = z.object({ ahead: count, behind: count, dirty: z.boolean(), changedFiles: count, checkedAt: z.number().optional() });

export const WorktreeDataSchema = z.object({
  path: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  ticketKey: z.string().optional(),
  /** cached `git status` / `rev-list` numbers for the ring */
  git: GitStatsSchema.optional(),
});

export const RecordTypeSchema = z.enum(['plan', 'brainstorm', 'grill', 'verification']);
export const RecordDataSchema = z.object({
  recordType: RecordTypeSchema,
  /** `<projectBaseDir>/records/<ticket-branch>/<name>.md` (absolute once the project is configured) */
  path: z.string(),
  ticketBranch: z.string().optional(),
  ticketKey: z.string().optional(),
  status: z.enum(['draft', 'approved', 'done']),
  /** plan progress: checked / total steps */
  steps: z.object({ done: count, total: count }).optional(),
  /** who wrote it: an agent handle or "you" */
  author: z.string().optional(),
});

export const QuestionSchema = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  multiSelect: z.boolean().optional(),
});
export const AgentStatusSchema = z.enum(['running', 'waiting', 'idle', 'done', 'failed']);
export const AgentDataSchema = z.object({
  /** Claude Code session id (from the stream-json `system/init` event) */
  sessionId: z.string().optional(),
  cwd: z.string(),
  model: z.string().optional(),
  status: AgentStatusSchema,
  /** the skill it was started with, e.g. `implement` */
  skill: z.string().optional(),
  /** an open AskUserQuestion tool call */
  pendingQuestion: z.object({ toolUseId: z.string(), questions: z.array(QuestionSchema).min(1) }).optional(),
  /** one line on what it is doing / did last */
  lastActivity: z.string().optional(),
  /** Cortex's id of the Claude Code session in main (`claude:start` localId); unset = not a real session (demo) */
  localId: z.string().optional(),
  /** tool calls waiting for allow / deny (other than AskUserQuestion) */
  pendingPermissions: z.array(z.object({ requestId: z.string(), toolName: z.string(), summary: z.string().optional() })).optional(),
  /** why it failed (last stderr lines / error) */
  error: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  usage: z.object({ contextPct: z.number().optional(), costUsd: z.number().optional(), turns: count.optional() }).optional(),
});

export const PrDataSchema = z.object({
  repo: z.string(),
  number: z.number().int().positive(),
  headBranch: z.string(),
  baseBranch: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  isDraft: z.boolean(),
  author: z.string().optional(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).optional(),
  /** approvals / requested reviewers, for the hover card */
  reviews: z.object({ approved: count, requested: count }).optional(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']).optional(),
  /** GitHub's mergeStateStatus (DIRTY = conflicts, BEHIND, BLOCKED, CLEAN, …); unknown values are dropped */
  mergeStateStatus: z.enum(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE']).optional().catch(undefined),
  checks: ChecksSchema.optional(),
  additions: count.optional(),
  deletions: count.optional(),
  /** the PR item this one is stacked on (its base branch is that PR's head) */
  stackedOn: z.string().optional(),
});

export const BuildDataSchema = z.object({
  repo: z.string(),
  /** workflow / job name */
  name: z.string(),
  /** details page (GitHub run or the Jenkins job behind a check) */
  url: z.string(),
  runId: z.string().optional(),
  number: z.number().int().optional(),
  state: z.enum(['queued', 'in_progress', 'completed']),
  conclusion: z.enum(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral']).optional(),
  prNumber: z.number().int().optional(),
  branch: z.string(),
  /** current or failing stage */
  stage: z.string().optional(),
  trigger: z.string().optional(),
  durationSec: z.number().optional(),
});

export const ProcStateSchema = z.enum(['starting', 'running', 'stopped', 'crashed']);
export const AppDataSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  url: z.string().optional(),
  port: z.number().int().optional(),
  /** `proc:start` id while it runs */
  procId: z.string().optional(),
  state: ProcStateSchema,
  /** the worktree it runs from, if not the project's base dir */
  worktreeId: z.string().optional(),
});

export const DeploymentStageSchema = z.enum(['dev', 'staging', 'prod', 'custom']);
export const DeploymentDataSchema = z.object({
  url: z.string(),
  stage: DeploymentStageSchema,
  /** label for `custom` stages (e.g. "perf"); overrides the stage name on the chip */
  stageLabel: z.string().optional(),
  /** mocked until there is a health integration */
  health: z.enum(['up', 'degraded', 'down', 'unknown']).optional(),
  version: z.string().optional(),
});

export const TodoDataSchema = z.object({ body: z.string(), done: z.boolean() });

export const TestRunDataSchema = z.object({
  command: z.string(),
  cwd: z.string(),
  procId: z.string().optional(),
  state: z.enum(['idle', 'running', 'passed', 'failed', 'stopped']),
  summary: z.object({ passed: count, failed: count, skipped: count }).optional(),
  /** last lines of output (kept short) */
  outputTail: z.string().max(8000).optional(),
  worktreeId: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

// ---- items ---------------------------------------------------------------------------------

const item = <K extends (typeof KINDS)[number], D extends z.ZodType>(kind: K, data: D) => z.object({ ...common, kind: z.literal(kind), data });

export const ItemSchemas = {
  project: item('project', ProjectDataSchema),
  ticket: item('ticket', TicketDataSchema),
  worktree: item('worktree', WorktreeDataSchema),
  record: item('record', RecordDataSchema),
  pr: item('pr', PrDataSchema),
  agent: item('agent', AgentDataSchema),
  app: item('app', AppDataSchema),
  build: item('build', BuildDataSchema),
  deployment: item('deployment', DeploymentDataSchema),
  todo: item('todo', TodoDataSchema),
  testrun: item('testrun', TestRunDataSchema),
} as const;

export const ItemSchema = z.discriminatedUnion('kind', [
  ItemSchemas.project,
  ItemSchemas.ticket,
  ItemSchemas.worktree,
  ItemSchemas.record,
  ItemSchemas.pr,
  ItemSchemas.agent,
  ItemSchemas.app,
  ItemSchemas.build,
  ItemSchemas.deployment,
  ItemSchemas.todo,
  ItemSchemas.testrun,
]);

export const LinkSchema = z.object({ id: z.string(), from: z.string(), to: z.string(), label: z.string() });

// ---- workspace file ------------------------------------------------------------------------

export const StatusGroupSchema = z.enum(['attention', 'failing', 'running', 'active', 'review', 'done', 'idle']);

export const FilterSchema = z.object({
  /** kinds to show; empty = every kind (v3; before that `hiddenKinds`) */
  kinds: z.array(KindSchema),
  /** status buckets to keep; empty = any status */
  status: z.array(StatusGroupSchema),
  /** project ids whose items to keep; empty = every project */
  projects: z.array(z.string()),
  /** free text on handle, title and subtitle */
  query: z.string(),
  /** only items with an unread notification */
  unreadOnly: z.boolean(),
  /** show archived items (faded) next to the live ones */
  showArchived: z.boolean(),
});

export const ColorBySchema = z.enum(['none', 'project', 'ticket']);

/** Claude Code `--permission-mode` for new sessions ('default' = the CLI asks for tools it may not run). */
/** `claude --permission-mode` choices (Claude Code 2.1.325) plus `default` = don't pass the flag */
export const PermissionModeSchema = z.enum(['default', 'manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);

export const PrefsSchema = z.object({
  /** OS notifications for new notices */
  desktopNotify: z.boolean(),
  /** chime for new notices */
  soundOn: z.boolean(),
  /** what bubbles are coloured by */
  colorBy: ColorBySchema,
  /** last filter; an outdated one (e.g. unknown kinds) is dropped rather than failing the prefs */
  filter: FilterSchema.optional().catch(undefined),
  // v2: integrations / layout settings (a bad value falls back to its default instead of resetting all prefs)
  /** Claude Code model for new sessions; unset = the CLI's default */
  model: z.string().min(1).optional().catch(undefined),
  permissionMode: PermissionModeSchema.catch('default'),
  /** PR comment that triggers the AI review; unset = main's config (`@claude review` / CORTEX_AI_REVIEW_COMMENT) */
  aiReviewComment: z.string().min(1).optional().catch(undefined),
  /** background refresh of the canvas caches (git stats, PR / ticket status), seconds */
  refreshSec: z.number().int().min(10).max(3600).catch(60),
  /** details sidebar width, px */
  sidebarWidth: z.number().int().min(280).max(2400).catch(360),
});

export const CameraSchema = z.object({ x: z.number(), y: z.number(), k: z.number().positive() });

/**
 * The file as stored. Items are validated one by one in `parseWorkspace` (a single bad
 * item is dropped rather than throwing the whole workspace away), so here they are `unknown`.
 */
export const WorkspaceFileSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  items: z.array(z.unknown()),
  links: z.array(z.unknown()),
  prefs: PrefsSchema.partial().optional(),
  camera: CameraSchema.optional(),
});

export const WorkspaceSchema = z.object({
  version: z.literal(WORKSPACE_VERSION),
  items: z.array(ItemSchema),
  links: z.array(LinkSchema),
  prefs: PrefsSchema,
  camera: CameraSchema.optional(),
});
