/**
 * Derived "what does this work item need?" logic. The sidebar groups cards by
 * it and every card offers the resulting next-best action as its main button.
 */
import type { AgentSession, PullRequest, WorkItem } from '../model/types';
import {
  archiveWork,
  createPr,
  createWorktree,
  launchAgent,
  markPrReady,
  mergePr,
  openSession,
  selectWork,
} from './actions';

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

export const awaitsMyReview = (w: WorkItem, me: string) =>
  !!w.pr?.reviewRequested && w.pr.reviewers.some((r) => r.name === me && r.state === 'pending');

export const readyToMerge = (w: WorkItem) =>
  !!w.pr && !w.pr.reviewRequested && w.pr.state === 'approved' && w.pipeline?.status === 'passed';

const sessionsOf = (w: WorkItem, sessions: AgentSession[]) => sessions.filter((s) => s.workId === w.id);

export function attentionOf(w: WorkItem, sessions: AgentSession[], me: string): Attention {
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
  if (w.pr && !w.pr.reviewRequested && (w.pr.state === 'changes-requested' || unresolvedThreads(w.pr) > 0))
    return { group: 'needs-you', tone: 'warning', reason: 'Changes requested' };
  if (readyToMerge(w)) return { group: 'needs-you', tone: 'success', reason: 'Ready to merge' };
  return { group: 'idle', tone: 'neutral' };
}

export function nextActionOf(w: WorkItem, sessions: AgentSession[], me: string): NextAction | undefined {
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
  if (w.pr && unresolvedThreads(w.pr) > 0)
    return { id: 'address', label: 'Address feedback', hint: 'Launch an agent on the unresolved review comments', run: () => launchAgent(w.id, 'review') };
  if (readyToMerge(w))
    return { id: 'merge', label: 'Merge', hint: 'Approved and green', busyKey: 'merge', run: () => void mergePr(w.id) };
  if (w.pr?.state === 'draft' && !building)
    return { id: 'ready', label: 'Mark ready', hint: 'Request review', run: () => markPrReady(w.id) };
  if (w.pr) return undefined;

  if (!w.worktree)
    return { id: 'worktree', label: 'Create worktree', hint: `Branch off ${w.repo}@main`, busyKey: 'worktree', run: () => void createWorktree(w.id) };
  if (!w.planMd && !mine.some((s) => s.kind === 'implement'))
    return { id: 'plan', label: 'Plan', hint: 'Let Claude draft an implementation plan', run: () => launchAgent(w.id, 'plan') };
  if (w.worktree.ahead === 0 || !mine.some((s) => s.kind === 'implement'))
    return { id: 'implement', label: 'Implement', hint: 'Launch an agent to implement the plan', run: () => launchAgent(w.id, 'implement') };
  return { id: 'pr', label: 'Create PR', hint: `Open a draft PR for ${w.worktree.branch}`, busyKey: 'pr', run: () => void createPr(w.id) };
}

export function relativeTime(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
