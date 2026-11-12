/**
 * Things that happen in the mock world without the user doing anything: a colleague reviews, somebody asks
 * for a review. They make notifications observable without real tools (and are what the background refresh
 * in state/sync.ts exists to notice). The real counterparts are other people on GitHub.
 * All timing lives here, short enough to watch.
 */
import { makeDraftPr } from '../../mock/seed/prs';
import type { PullRequest, ReviewThread } from '../../model/types';
import { config } from '../config';
import { findPr, ME, world } from './world';

export const OUTSIDE_DELAYS = {
  /** after a PR was marked ready: a reviewer leaves an inline comment ... */
  commentAfterReady: 12_000,
  /** ... and approves it */
  approveAfterReady: 26_000,
  /** after load: Jonas Becker approves #491 (CTX-1423) */
  colleagueApproves: 20_000,
  /** after load: Priya Raman asks for my review of a new PR in query-service */
  reviewRequested: 34_000,
};

const now = () => new Date().toISOString();
let seq = 0;
const uid = (p: string) => `${p}_out${Date.now().toString(36)}${++seq}`;

/** An inline comment on a real added line of the diff, so it anchors properly. */
function commentThread(pr: PullRequest, author: string, body: string): ReviewThread[] {
  const taken = new Set(pr.threads.map((t) => `${t.filePath}:${t.line}`));
  for (const file of pr.files) {
    if (file.status === 'deleted') continue;
    const line = file.hunks.flatMap((h) => h.lines).find((l) => l.type === 'add' && l.newNo !== undefined && l.content.trim().length >= 24 && !taken.has(`${file.path}:${l.newNo}`));
    if (line) return [{ id: uid('rt'), filePath: file.path, line: line.newNo!, side: 'new', resolved: false, comments: [{ id: uid('rc'), author, at: now(), body }] }];
  }
  return [];
}

const reviewerOf = (pr: PullRequest) => pr.reviewers.find((r) => r.name !== ME.name && r.name !== config.aiReview.botLogin)?.name ?? 'Mila Novak';
const setReviewer = (pr: PullRequest, name: string, state: 'approved' | 'changes-requested' | 'commented') => {
  pr.reviewers = pr.reviewers.some((r) => r.name === name) ? pr.reviewers.map((r) => (r.name === name ? { ...r, state } : r)) : [...pr.reviewers, { name, state }];
  pr.updatedAt = now();
};

const readied = new Set<string>();

/** A PR was marked ready for review: somebody looks at it, comments, then approves (if it is still open by then). */
export function reviewersLookAt(repo: string, pr: PullRequest) {
  const key = `${repo}#${pr.number}`;
  if (readied.has(key)) return;
  readied.add(key);
  const reviewer = reviewerOf(pr);
  setTimeout(() => {
    if (pr.state === 'merged') return;
    pr.threads = [...pr.threads, ...commentThread(pr, reviewer, 'Could this take the timeout from the config instead of a literal? Otherwise this looks good to me.')];
    setReviewer(pr, reviewer, 'commented');
  }, OUTSIDE_DELAYS.commentAfterReady);
  setTimeout(() => {
    if (pr.state !== 'open') return;
    pr.state = 'approved';
    setReviewer(pr, reviewer, 'approved');
  }, OUTSIDE_DELAYS.approveAfterReady);
}

/** Starts the timers of the events that happen on their own after load. */
export function startOutsideWorld() {
  setTimeout(() => {
    const pr = findPr('ingest-gateway', 491)?.pr;
    if (pr?.reviewers.some((r) => r.name === 'Jonas Becker' && r.state === 'pending')) setReviewer(pr, 'Jonas Becker', 'approved');
  }, OUTSIDE_DELAYS.colleagueApproves);

  setTimeout(() => {
    const title = 'Cap query result page size per tenant';
    const repo = 'query-service';
    if (world.workspace.work.some((w) => w.id === 'review-488')) return;
    const pr: PullRequest = {
      ...makeDraftPr({ id: 'review-488', kind: 'review', title, repo, app: { status: 'stopped', logs: [] }, updatedAt: now() }, 'Priya Raman'),
      number: 488,
      title: `CTX-1380 ${title}`,
      state: 'open',
      sourceBranch: 'feature/CTX-1380-page-size-cap',
      targetBranch: 'main',
      reviewers: [{ name: ME.name, state: 'pending' }],
    };
    world.prs.push({ repo, pr });
    // the bridge would add review requests to the workspace file; the app finds it on its next refresh
    world.workspace.work.unshift({ id: 'review-488', kind: 'review', title: `Review #488 · ${title}`, repo, prNumber: 488, createdAt: now() });
  }, OUTSIDE_DELAYS.reviewRequested);
}
