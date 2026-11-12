/**
 * Derived "what does this work item need?" logic. The sidebar groups cards by
 * it and every card offers the resulting next-best action as its main button.
 */
import type { AgentSession, CreatePrInput, PullRequest, WorkItem } from '../model/types';
import { awaitsMyReview } from '../model/work';
import {
  archiveWork,
  createWorktree,
  launchAgent,
  markPrReady,
  mergePr,
  openCreatePrDialog,
  openSession,
  retargetPr,
  selectWork,
} from './actions';
import { projectBase } from './sync';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'critical';
export type AttentionGroup = 'needs-you' | 'in-flight' | 'idle';

export interface Attention {
  group: AttentionGroup;
  tone: Tone;
  /** short reason, shown on the card when it needs me */
  reason?: string;
}

export interface NextAction {
  id: string;
  label: string;
  hint: string;
  /** key for useBusy(workId, …) while the action is in flight */
  busyKey?: string;
  run: () => void;
}

export const unresolvedThreads = (pr?: PullRequest) => pr?.threads.filter((t) => !t.resolved).length ?? 0;

export const pendingComments = (pr: PullRequest | undefined) =>
  pr?.threads.reduce((n, t) => n + t.comments.filter((c) => c.pending).length, 0) ?? 0;

export { awaitsMyReview };

// ---- stacked PRs -----------------------------------------------------------------
// A PR is "stacked" when its base branch is the head branch of another PR (or worktree) on the board.

/** Branch this work is based on: the PR's target, else the worktree's base. */
export const baseOf = (w: WorkItem) => w.pr?.targetBranch ?? w.worktree?.baseBranch;
/** Branch this work lives on. */
export const headOf = (w: WorkItem) => w.pr?.sourceBranch ?? w.worktree?.branch;

/** The board work item (same repo) whose head branch is this work's base branch. */
export function parentOf(w: WorkItem, all: WorkItem[]): WorkItem | undefined {
  const base = baseOf(w);
  return base ? all.find((o) => o.id !== w.id && o.repo === w.repo && headOf(o) === base) : undefined;
}

/** Board work items that are based on this work's branch. */
export function childrenOf(w: WorkItem, all: WorkItem[]): WorkItem[] {
  const head = headOf(w);
  return head ? all.filter((o) => o.id !== w.id && o.repo === w.repo && baseOf(o) === head) : [];
}

/** Parent chain, closest first (guards against cycles). */
export function ancestorsOf(w: WorkItem, all: WorkItem[]): WorkItem[] {
  const out: WorkItem[] = [];
  for (let p = parentOf(w, all); p && !out.includes(p) && p !== w; p = parentOf(p, all)) out.push(p);
  return out;
}

/** The parent whose PR is still unmerged — merging this PR has to wait for it. */
export const blockingParent = (w: WorkItem, all: WorkItem[]) => {
  const p = parentOf(w, all);
  return p?.pr && p.pr.state !== 'merged' ? p : undefined;
};

/** The parent was merged, so this PR still points at a branch that is gone: it should be retargeted. */
export const needsRetarget = (w: WorkItem, all: WorkItem[]) => {
  const p = parentOf(w, all);
  return !!w.pr && !w.pr.reviewRequested && w.pr.state !== 'merged' && p?.pr?.state === 'merged';
};

export const prLabel = (w: WorkItem) => (w.pr ? `#${w.pr.number}` : (headOf(w) ?? w.title));

export const aiReviewPending = (pr?: PullRequest) => !!pr?.reviewers.some((r) => r.isBot && r.state === 'pending');

export const readyToMerge = (w: WorkItem, all: WorkItem[]) =>
  !!w.pr && !w.pr.reviewRequested && w.pr.state === 'approved' && w.pipeline?.status === 'passed' && !blockingParent(w, all);

/** What the "Create pull request" dialog starts with. */
export function prefillOf(w: WorkItem, base: string): CreatePrInput {
  const t = w.ticket;
  const plan = w.planMd ? `\n\nPlan: [implementation plan in Cortex](${location.href.split('#')[0]}#/${w.id}/ticket)` : '';
  const criteria = t?.acceptanceCriteria.length ? `\n\n## Acceptance criteria\n\n${t.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n')}` : '';
  return {
    title: t ? `${t.key} ${t.summary}` : w.title,
    body: t ? `Implements **${t.key}** — ${t.summary}.${criteria}${plan}\n` : `${w.title}${plan}\n`,
    base,
    draft: true,
    reviewers: [],
  };
}

const sessionsOf = (w: WorkItem, sessions: AgentSession[]) => sessions.filter((s) => s.workId === w.id);

export function attentionOf(w: WorkItem, sessions: AgentSession[], me: string, all: WorkItem[]): Attention {
  const mine = sessionsOf(w, sessions);
  const running = mine.some((s) => s.status === 'running');
  const building = w.pipeline?.status === 'running' || w.pipeline?.status === 'queued';

  if (mine.some((s) => s.status === 'waiting' && s.activity))
    return { group: 'needs-you', tone: 'warning', reason: 'Claude is waiting for you' };
  // An agent or a fresh build is already on it — nothing for me to do right now.
  if (running) return { group: 'in-flight', tone: 'primary', reason: 'Claude is working' };
  if (building) return { group: 'in-flight', tone: 'primary', reason: `Build #${w.pipeline!.buildNumber} running` };
  if (w.app.status === 'starting') return { group: 'in-flight', tone: 'primary', reason: 'Starting app' };

  if (w.pr?.state === 'merged') return { group: 'idle', tone: 'success' };
  if (w.pipeline?.status === 'failed')
    return { group: 'needs-you', tone: 'critical', reason: `Build #${w.pipeline.buildNumber} failed` };
  if (awaitsMyReview(w, me)) return { group: 'needs-you', tone: 'primary', reason: 'Your review is requested' };
  if (needsRetarget(w, all)) return { group: 'needs-you', tone: 'primary', reason: 'Parent merged — retarget' };
  if (w.pr && !w.pr.reviewRequested && (w.pr.state === 'changes-requested' || unresolvedThreads(w.pr) > 0))
    return { group: 'needs-you', tone: 'warning', reason: 'Changes requested' };
  if (readyToMerge(w, all)) return { group: 'needs-you', tone: 'success', reason: 'Ready to merge' };
  const blocker = blockingParent(w, all);
  if (blocker && w.pr?.state === 'approved') return { group: 'idle', tone: 'neutral', reason: `Merge #${blocker.pr!.number} first` };
  return { group: 'idle', tone: 'neutral' };
}

export function nextActionOf(w: WorkItem, sessions: AgentSession[], me: string, all: WorkItem[]): NextAction | undefined {
  const mine = sessionsOf(w, sessions);
  const waiting = mine.find((s) => s.status === 'waiting' && s.activity);
  if (waiting)
    return { id: 'reply', label: 'Reply', hint: 'Open the session that is waiting for you', run: () => { selectWork(w.id); openSession(waiting.id); } };
  if (mine.some((s) => s.status === 'running')) return undefined;

  if (w.pr?.state === 'merged')
    return { id: 'archive', label: 'Archive', hint: 'Merged — remove from the board', run: () => archiveWork(w.id) };
  if (w.pr?.reviewRequested)
    return awaitsMyReview(w, me)
      ? { id: 'review', label: 'Review', hint: 'Open the diff', run: () => selectWork(w.id, 'review') }
      : { id: 'archive', label: 'Archive', hint: 'Review submitted — remove from the board', run: () => archiveWork(w.id) };

  const building = w.pipeline?.status === 'running' || w.pipeline?.status === 'queued';
  if (w.pipeline?.status === 'failed')
    return { id: 'fix-ci', label: 'Fix CI', hint: 'Launch an agent on the failing stage', run: () => launchAgent(w.id, 'fix-ci') };
  if (needsRetarget(w, all))
    return { id: 'retarget', label: 'Retarget', hint: `Parent #${parentOf(w, all)!.pr!.number} is merged — retarget this PR to ${projectBase(w.repo)}`, busyKey: 'retarget', run: () => void retargetPr(w.id) };
  if (w.pr && unresolvedThreads(w.pr) > 0)
    return { id: 'address', label: 'Address feedback', hint: 'Launch an agent on the unresolved review comments', run: () => launchAgent(w.id, 'review') };
  if (readyToMerge(w, all))
    return { id: 'merge', label: 'Merge', hint: 'Approved and green', busyKey: 'merge', run: () => void mergePr(w.id) };
  const blocker = blockingParent(w, all);
  if (blocker && w.pr?.state === 'approved')
    return { id: 'merge-parent', label: `Open #${blocker.pr!.number}`, hint: `Merge #${blocker.pr!.number} first — this PR is stacked on it`, run: () => selectWork(blocker.id, 'review') };
  if (w.pr?.state === 'draft' && !building)
    return { id: 'ready', label: 'Mark ready', hint: 'Request review', run: () => markPrReady(w.id) };
  if (w.pr) return undefined;

  if (!w.worktree)
    return { id: 'worktree', label: 'Create worktree', hint: `Branch off ${w.repo}@main`, busyKey: 'worktree', run: () => void createWorktree(w.id) };
  if (!w.planMd && !mine.some((s) => s.kind === 'implement'))
    return { id: 'plan', label: 'Plan', hint: 'Let Claude draft an implementation plan', run: () => launchAgent(w.id, 'plan') };
  if (w.worktree.ahead === 0 || !mine.some((s) => s.kind === 'implement'))
    return { id: 'implement', label: 'Implement', hint: 'Launch an agent to implement the plan', run: () => launchAgent(w.id, 'implement') };
  return { id: 'pr', label: 'Create PR', hint: `Open a PR for ${w.worktree.branch}`, busyKey: 'pr', run: () => openCreatePrDialog(w.id) };
}

export function relativeTime(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
