/**
 * Pure PR helpers: ring, action availability, merge form → op arguments, stack lookups.
 * No React, no store, no native calls (unit-tested in `logic.test.ts`).
 */
import type { GhMergeMethod } from '../../../../shared/integrations/github';
import { codeHost } from '../../data/codehost';
import { isRealRepo, type Item, type ItemOf, type PrData, type Segment } from '../../domain';

type Pr = ItemOf<'pr'>;

/** A GitHub `owner/name` that gh can reach (demo items use `unknown/…`). */
export { isRealRepo };

export const prUrl = (d: Pick<PrData, 'repo' | 'number' | 'provider'>) => codeHost(d.provider).prUrl(d.repo, d.number);

/** Checks are fine for merging: green, or there are none. */
const checksOk = (d: PrData) => !d.checks || d.checks.state === 'success' || d.checks.state === 'none';

/** Merge conflicts: `mergeable` CONFLICTING, or GitHub's mergeStateStatus DIRTY. */
export const hasConflicts = (d: Pick<PrData, 'mergeable' | 'mergeStateStatus'>) => d.mergeable === 'CONFLICTING' || d.mergeStateStatus === 'DIRTY';

export const isMergeable = ({ data: d }: Pr) => d.state === 'open' && !d.isDraft && d.reviewDecision === 'APPROVED' && d.mergeable === 'MERGEABLE' && !hasConflicts(d) && checksOk(d);

/**
 * Status ring. Mirrors the refresher's `prPatch` / `summarizePr` (draft wins over the review
 * state, conflicts and checks are separate slices), so an approved but conflicting PR shows a
 * split ring: green (approved) + orange (conflict) (+ red when checks fail).
 */
export function prRing(pr: Pr): Segment[] {
  const d = pr.data;
  if (d.state === 'merged') return [{ tone: 'success', label: 'Merged' }];
  if (d.state === 'closed') return [{ tone: 'neutral', label: 'Closed' }];
  if (isMergeable(pr)) return [{ tone: 'success', label: 'Approved, checks green, mergeable' }];
  const out: Segment[] = [];
  if (d.isDraft) out.push({ tone: 'neutral', label: 'Draft' });
  else if (d.reviewDecision === 'APPROVED') out.push({ tone: 'success', label: d.reviews ? `Approved (${d.reviews.approved} / ${d.reviews.requested})` : 'Approved' });
  else if (d.reviewDecision === 'CHANGES_REQUESTED') out.push({ tone: 'warning', label: 'Changes requested' });
  else out.push({ tone: 'pending', label: d.reviews ? `Review pending (${d.reviews.requested} reviewer${d.reviews.requested === 1 ? '' : 's'})` : 'Review pending' });
  if (hasConflicts(d)) out.push({ tone: 'warning', label: 'Merge conflict' });
  if (d.checks?.state === 'failure') out.push({ tone: 'critical', label: d.checks.failed ? `${d.checks.failed} check${d.checks.failed === 1 ? '' : 's'} failing` : 'Checks failing' });
  else if (d.checks?.state === 'pending') out.push({ tone: 'running', label: 'Checks running' });
  return out;
}

// ---- action availability -------------------------------------------------------------------

/** Why a gh write action can't run on this PR (undefined = it can). */
export function ghBlocked(d: PrData): string | undefined {
  if (!isRealRepo(d.repo)) return 'Not a GitHub repository Cortex can reach';
  if (d.state !== 'open') return `PR is ${d.state}`;
  return undefined;
}

export function mergeBlocked(d: PrData): string | undefined {
  return ghBlocked(d) ?? (d.isDraft ? 'Draft: mark it ready for review first' : undefined);
}

/** Things worth a second look before merging (shown in the merge form). */
export function mergeWarnings(d: PrData): string[] {
  const w: string[] = [];
  if (d.checks?.state === 'failure') w.push(d.checks.failed ? `${d.checks.failed} check${d.checks.failed === 1 ? ' is' : 's are'} failing` : 'checks are failing');
  else if (d.checks?.state === 'pending') w.push('checks are still running');
  if (d.reviewDecision !== 'APPROVED') w.push(d.reviewDecision === 'CHANGES_REQUESTED' ? 'changes were requested' : 'it is not approved');
  if (hasConflicts(d)) w.push('it has merge conflicts');
  return w;
}

export const MERGE_METHODS: { value: GhMergeMethod; label: string; hint: string }[] = [
  { value: 'squash', label: 'Squash and merge', hint: 'One commit on the base branch' },
  { value: 'merge', label: 'Create a merge commit', hint: 'Keeps every commit plus a merge commit' },
  { value: 'rebase', label: 'Rebase and merge', hint: 'Replays the commits onto the base branch' },
];

/** Merge form values → `CodeHost.prMerge` arguments. */
export function mergeArgs(d: Pick<PrData, 'repo' | 'number'>, values: Record<string, string | boolean>): [string, number, GhMergeMethod, { deleteBranch: boolean }] {
  const m = values.method;
  const method: GhMergeMethod = m === 'merge' || m === 'rebase' ? m : 'squash';
  return [d.repo, d.number, method, { deleteBranch: values.deleteBranch === true }];
}

// ---- stack -------------------------------------------------------------------------------

/** Open PRs stacked directly on this one. */
export const stackChildren = (items: Item[], prId: string): Pr[] => items.filter((i): i is Pr => i.kind === 'pr' && i.data.stackedOn === prId && i.data.state === 'open' && !i.archived);

/**
 * After the parent merged: GitHub retargets stacked PRs to the parent's base by itself when the
 * parent's head branch is deleted. Otherwise the child still points at the old branch and is
 * retargeted with `gh pr edit --base` (the "Retarget onto …" toast / action).
 */
export function retargetPlan(parent: PrData, children: Pr[], deletedBranch: boolean) {
  return children.filter((c) => c.data.baseBranch === parent.headBranch || !c.data.baseBranch).map((c) => ({ child: c, newBase: parent.baseBranch, automatic: deletedBranch }));
}

/** The child of a merged parent still targets the parent's head branch (→ "Retarget onto <parent base>"). */
export const needsRetarget = (child: PrData, parent: PrData | undefined) => !!parent && parent.state === 'merged' && child.state === 'open' && child.baseBranch === parent.headBranch;

/** The worktree a PR comes from: a linked one, else one in the project on the head branch. */
export function worktreeOf(pr: Pr, linked: ItemOf<'worktree'>[], inProject: ItemOf<'worktree'>[]): ItemOf<'worktree'> | undefined {
  const live = (w: ItemOf<'worktree'>) => !w.archived;
  return linked.find(live) ?? (pr.data.headBranch ? inProject.find((w) => live(w) && w.data.branch === pr.data.headBranch) : undefined);
}

/** A comment / review by the AI review bot (config.json `github.aiReviewBot`; gh drops the `[bot]` suffix of app logins). */
export const isAiReviewer = (login: string | undefined, bot: string) => {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/^app\//, '')
      .replace(/\[bot\]$/, '');
  return !!login && !!bot && norm(login) === norm(bot);
};
