/**
 * GitHub (`gh` CLI) DTOs, shaped like what `gh … --json` prints (verified against gh 2.102),
 * and pure mappers to compact summaries for the UI. Dependency free.
 */

export interface GhUser {
  login: string;
  /** often an empty string */
  name?: string;
  id?: string;
  /** GitHub Apps such as Renovate (`app/renovate`) */
  is_bot?: boolean;
}

export interface GhLabel {
  name: string;
  color?: string;
  id?: string;
  description?: string;
}

export type GhPrState = 'OPEN' | 'CLOSED' | 'MERGED';
export type GhReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '';
export type GhReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
export type GhMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
/** why a PR can or cannot be merged right now */
export type GhMergeStateStatus = 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE';

/** One entry of `statusCheckRollup`: a check run (Actions, Jenkins via the Checks API) or a commit status. */
export type GhStatusCheck =
  | {
      __typename: 'CheckRun';
      name: string;
      workflowName?: string;
      status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'WAITING' | 'PENDING' | 'REQUESTED';
      /** empty until COMPLETED */
      conclusion: 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'SKIPPED' | 'TIMED_OUT' | 'ACTION_REQUIRED' | 'STALE' | 'STARTUP_FAILURE' | '';
      detailsUrl?: string;
      startedAt?: string;
      completedAt?: string;
    }
  | { __typename: 'StatusContext'; context: string; state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED'; targetUrl?: string; startedAt?: string };

export interface GhReview {
  author: GhUser;
  state: GhReviewState;
  body?: string;
  submittedAt?: string;
  id?: string;
}

export interface GhComment {
  id: string;
  author: GhUser;
  body: string;
  createdAt: string;
  url?: string;
  authorAssociation?: string;
}

export interface GhPrFile {
  path: string;
  additions: number;
  deletions: number;
  changeType?: 'ADDED' | 'DELETED' | 'MODIFIED' | 'RENAMED' | 'COPIED' | 'CHANGED';
}

/** `gh pr list --json <GH_PR_LIST_FIELDS>` */
export interface GhPrListItem {
  number: number;
  title: string;
  state: GhPrState;
  isDraft: boolean;
  url: string;
  author: GhUser;
  headRefName: string;
  baseRefName: string;
  labels: GhLabel[];
  updatedAt: string;
  statusCheckRollup: GhStatusCheck[];
  reviewDecision: GhReviewDecision;
  additions: number;
  deletions: number;
}

export const GH_PR_LIST_FIELDS =
  'number,title,state,isDraft,url,author,headRefName,baseRefName,labels,updatedAt,statusCheckRollup,reviewDecision,additions,deletions';

/** `gh pr view <n> --json <GH_PR_FIELDS>` */
export interface GhPullRequest extends GhPrListItem {
  body: string;
  createdAt: string;
  headRefOid: string;
  reviewRequests: (GhUser | { name?: string; slug?: string; __typename?: string })[];
  latestReviews: GhReview[];
  mergeable: GhMergeable;
  mergeStateStatus: GhMergeStateStatus;
  files: GhPrFile[];
  comments: GhComment[];
  changedFiles: number;
  mergedAt: string | null;
  closed: boolean;
}

export const GH_PR_FIELDS = `${GH_PR_LIST_FIELDS},body,createdAt,headRefOid,reviewRequests,latestReviews,mergeable,mergeStateStatus,files,comments,changedFiles,mergedAt,closed`;

/** `gh pr checks <n> --json <GH_CHECK_FIELDS>` */
export interface GhCheck {
  name: string;
  /** e.g. SUCCESS, FAILURE, IN_PROGRESS, QUEUED, SKIPPED, PENDING */
  state: string;
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';
  link: string;
  workflow: string;
  description: string;
  event: string;
  startedAt: string;
  completedAt: string;
}

export const GH_CHECK_FIELDS = 'bucket,completedAt,description,event,link,name,startedAt,state,workflow';

export interface GhRunJob {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
  url: string;
  steps?: { name: string; number: number; status: string; conclusion: string }[];
}

/** `gh run view <id> --json <GH_RUN_FIELDS>` */
export interface GhRun {
  databaseId: number;
  number: number;
  attempt: number;
  name: string;
  displayTitle: string;
  workflowName: string;
  event: string;
  headBranch: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: '' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | 'stale' | 'startup_failure';
  url: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  jobs: GhRunJob[];
}

export const GH_RUN_FIELDS = 'attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,jobs,name,number,startedAt,status,updatedAt,url,workflowName';

export type GhMergeMethod = 'merge' | 'squash' | 'rebase';

export type GhUpdateBranchResult = { ok: true; message: string } | { ok: false; conflicts: boolean; message: string };

// ---- mappers --------------------------------------------------------------------------

export type CheckRollup = 'none' | 'pending' | 'passed' | 'failed';

/** Rolls checks up into one state: any failure wins, then anything unfinished, else passed. */
export function rollupChecks(checks: GhStatusCheck[]): CheckRollup {
  if (checks.length === 0) return 'none';
  const state = (c: GhStatusCheck): 'ok' | 'bad' | 'wait' => {
    if (c.__typename === 'StatusContext') return c.state === 'SUCCESS' ? 'ok' : c.state === 'FAILURE' || c.state === 'ERROR' ? 'bad' : 'wait';
    if (c.status !== 'COMPLETED') return 'wait';
    return ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(c.conclusion) ? 'bad' : 'ok';
  };
  const all = checks.map(state);
  return all.includes('bad') ? 'failed' : all.includes('wait') ? 'pending' : 'passed';
}

/** Same roll-up for `gh pr checks` output. */
export function rollupBuckets(checks: GhCheck[]): CheckRollup {
  if (checks.length === 0) return 'none';
  if (checks.some((c) => c.bucket === 'fail' || c.bucket === 'cancel')) return 'failed';
  if (checks.some((c) => c.bucket === 'pending')) return 'pending';
  return 'passed';
}

export type PrSummaryState = 'draft' | 'open' | 'approved' | 'changes-requested' | 'merged' | 'closed';

export interface PrSummary {
  number: number;
  title: string;
  url: string;
  state: PrSummaryState;
  author: string;
  isBot: boolean;
  head: string;
  base: string;
  checks: CheckRollup;
  additions: number;
  deletions: number;
  updatedAt: string;
  labels: string[];
  /** only from `prView` */
  mergeable?: GhMergeable;
  mergeStateStatus?: GhMergeStateStatus;
  /** true when GitHub says the branch is behind its base (needs update / rebase) */
  behind?: boolean;
  conflicts?: boolean;
}

export const displayName = (u: GhUser) => u.name || u.login;

export function prState(pr: Pick<GhPrListItem, 'state' | 'isDraft' | 'reviewDecision'>): PrSummaryState {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  return 'open';
}

export function summarizePr(pr: GhPrListItem | GhPullRequest): PrSummary {
  const s: PrSummary = {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: prState(pr),
    author: pr.author?.login ?? '',
    isBot: !!pr.author?.is_bot,
    head: pr.headRefName,
    base: pr.baseRefName,
    checks: rollupChecks(pr.statusCheckRollup ?? []),
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    updatedAt: pr.updatedAt,
    labels: (pr.labels ?? []).map((l) => l.name),
  };
  if ('mergeable' in pr) {
    s.mergeable = pr.mergeable;
    s.mergeStateStatus = pr.mergeStateStatus;
    s.behind = pr.mergeStateStatus === 'BEHIND';
    s.conflicts = pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY';
  }
  return s;
}

export type UpdateType = 'major' | 'minor' | 'patch' | 'digest' | 'unknown';

/**
 * Renovate puts the kind of bump in a label (`major` / `minor` / `patch`, often `update-…` or `type: …`),
 * else the branch (`renovate/major-react-monorepo`), else the title ("… to v8" = major).
 */
export function updateTypeOf(pr: Pick<GhPrListItem, 'title' | 'headRefName' | 'labels'>): UpdateType {
  for (const l of pr.labels ?? []) {
    const hit = /\b(major|minor|patch|digest)\b/i.exec(l.name);
    if (hit) return (hit[1] ?? '').toLowerCase() as UpdateType;
  }
  const branch = /^renovate\/(major|minor|patch|digest)-/.exec(pr.headRefName);
  if (branch) return branch[1] as UpdateType;
  if (/\bdigest to [0-9a-f]{6,}/i.test(pr.title)) return 'digest';
  return /\bto v?\d+$/i.test(pr.title.trim()) ? 'major' : 'unknown';
}

/** A Renovate PR: authored by the Renovate app, or carrying the renovate label / branch prefix. */
export const isRenovatePr = (pr: Pick<GhPrListItem, 'author' | 'labels' | 'headRefName'>, botLogin = 'app/renovate') =>
  pr.author?.login === botLogin ||
  pr.author?.login === botLogin.replace(/^app\//, '') ||
  pr.headRefName.startsWith('renovate/') ||
  (pr.labels ?? []).some((l) => /renovate|dependencies/i.test(l.name));

/** PR number from a URL like https://github.com/o/r/pull/123 (what `gh pr create` prints). */
export function prNumberFromUrl(text: string): { number: number; url: string } | null {
  const m = /(https?:\/\/\S+\/pull\/(\d+))/.exec(text);
  return m ? { url: m[1] ?? '', number: Number(m[2]) } : null;
}

/** Does a `gh pr update-branch` failure message mean merge conflicts (vs. auth, network, …)? */
export const isConflictMessage = (text: string) => /conflict/i.test(text);
