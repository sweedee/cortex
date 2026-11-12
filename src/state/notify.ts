/**
 * Which changes are worth a notification. Pure functions: `before, after → notices`, no store, no
 * timers, no UI. state/sync.ts calls them at the two places where data changes (a work item was
 * re-fetched, a Claude event was applied) and hands the result to state/notifications.ts, which
 * drops what the user is looking at or just did themselves and stores the rest.
 *
 * Rule of thumb: only transitions count. Something that was already true before (the first load,
 * the same failed build seen again by the next refresh) never produces a notice.
 */
import { mostRelevantSession, needsInput, openQuestion } from '../model/session';
import { awaitsMyReview } from '../model/work';
import type { AgentSession, Notice, PullRequest, RenovatePr, ViewState, WorkItem } from '../model/types';
import { config, GLOBAL_SESSION_ID } from '../services/config';

const isBot = (author: string) => author === config.aiReview.botLogin;
const snippet = (text: string, max = 90) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
/** PR title without the leading ticket key (the subject already says it). */
const bare = (title: string) => title.replace(/^[A-Z][A-Z0-9]+-\d+[\s:]+/, '');
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "CTX-1423", or the title for work without a ticket. */
const subjectOf = (w: WorkItem) => w.ticket?.key ?? (w.kind === 'review' ? `PR #${w.pr?.number}` : w.title);

// ---- work items ---------------------------------------------------------------------

/**
 * Build and PR transitions of one work item. `before` is undefined for work that just appeared on the
 * board: only "somebody asked for my review" makes sense there.
 */
export function diffWork(before: WorkItem | undefined, after: WorkItem, me: string): Notice[] {
  const ctx = { workId: after.id, subject: subjectOf(after) };
  const out: Notice[] = [];

  if (awaitsMyReview(after, me) && !(before && awaitsMyReview(before, me))) {
    out.push({
      ...ctx,
      kind: 'review-requested',
      tone: 'primary',
      tab: 'review',
      title: `${after.pr!.author} asked for your review`,
      detail: `#${after.pr!.number} ${bare(after.pr!.title)}`,
    });
  }
  if (!before) return out;

  out.push(...diffBuild(before, after, ctx));
  if (before.pr && after.pr) out.push(...diffPr(before.pr, after.pr, me, ctx));
  return out;
}

type Ctx = { workId: string; subject: string };

function diffBuild(before: WorkItem, after: WorkItem, ctx: Ctx): Notice[] {
  const b = before.pipeline;
  const a = after.pipeline;
  if (!a) return [];
  const same = b?.buildNumber === a.buildNumber && b.status === a.status;
  if (same) return [];

  if (a.status === 'failed') {
    const stage = a.stages.find((s) => s.status === 'failed');
    return [{ ...ctx, kind: 'build-failed', tone: 'critical', tab: 'pipeline', title: `Build #${a.buildNumber} failed`, detail: stage ? `Failed in ${stage.name}` : undefined }];
  }
  // "passed again": the build before this one (or the one we just saw) was red
  if (a.status === 'passed' && (b?.status === 'failed' || a.history[0]?.status === 'failed')) {
    return [{ ...ctx, kind: 'build-fixed', tone: 'success', tab: 'pipeline', title: `Build #${a.buildNumber} passed`, detail: `Green again after build #${a.history[0]?.buildNumber ?? b?.buildNumber} failed` }];
  }
  return [];
}

function diffPr(before: PullRequest, after: PullRequest, me: string, ctx: Ctx): Notice[] {
  const out: Notice[] = [];
  const n = after.number;
  const base = { ...ctx, tab: 'review' as const };

  if (after.state === 'merged' && before.state !== 'merged') {
    out.push({ ...base, kind: 'pr-merged', tone: 'success', title: `#${n} was merged`, detail: bare(after.title) });
  }

  // new comments of somebody else, per author
  const known = new Set(before.threads.flatMap((t) => t.comments.map((c) => c.id)));
  const fresh = after.threads.flatMap((t) => t.comments).filter((c) => !known.has(c.id) && !c.pending && c.author !== me);
  const byAuthor = new Map<string, typeof fresh>();
  for (const c of fresh) byAuthor.set(c.author, [...(byAuthor.get(c.author) ?? []), c]);

  // verdicts on my own PR (reviews I give on somebody else's PR are my own doing)
  if (!after.reviewRequested) {
    const was = new Map(before.reviewers.map((r) => [r.name, r.state]));
    for (const r of after.reviewers) {
      if (r.name === me || r.isBot || was.get(r.name) === r.state) continue;
      if (r.state !== 'approved' && r.state !== 'changes-requested') continue;
      const comments = byAuthor.get(r.name);
      byAuthor.delete(r.name); // folded into the verdict
      const extra = comments ? plural(comments.length, 'new comment') : undefined;
      out.push(
        r.state === 'approved'
          ? { ...base, kind: 'pr-approved', tone: 'success', title: `${r.name} approved #${n}`, detail: extra ?? bare(after.title) }
          : { ...base, kind: 'changes-requested', tone: 'warning', title: `${r.name} requested changes on #${n}`, detail: extra ?? bare(after.title) },
      );
    }
  }

  for (const [author, comments] of byAuthor) {
    const detail = comments.length === 1 ? `#${n} · “${snippet(comments[0].body, 80)}”` : `${plural(comments.length, 'new comment')} on #${n}`;
    out.push({
      ...base,
      kind: 'review-comments',
      tone: 'primary',
      title: isBot(author) ? 'AI review is in' : `${author} commented`,
      detail: isBot(author) ? `${plural(comments.length, 'comment')} on #${n}` : detail,
    });
  }
  return out;
}

// ---- Claude sessions ----------------------------------------------------------------

/** Where a session lives: work item, project, or the global chat. */
const sessionTarget = (s: AgentSession) =>
  s.workId
    ? { workId: s.workId, tab: 'agents' as const, sessionId: s.id }
    : s.projectId
      ? { projectId: s.projectId, projectTab: 'work' as const, sessionId: s.id }
      : { sessionId: s.id };

/** The last thing Claude said, cut to what fits a notification (the question is usually at the end). */
function lastQuestion(s: AgentSession): string | undefined {
  const open = openQuestion(s.messages);
  if (open) return snippet(open.summary);
  const last = s.messages.findLast((m) => m.role === 'assistant');
  if (!last || last.role !== 'assistant') return undefined;
  const lines = last.text.split('\n').map((l) => l.trim()).filter(Boolean);
  return snippet(lines[lines.length - 1] ?? '');
}

/** `subject` names the work item / project / chat the session belongs to. */
export function diffSession(before: AgentSession | undefined, after: AgentSession, subject: string): Notice[] {
  const ctx = { ...sessionTarget(after), subject };
  if (needsInput(after) && !(before && needsInput(before))) {
    return [{ ...ctx, kind: 'claude-asks', tone: 'warning', title: 'Claude needs your input', detail: lastQuestion(after) ?? after.title }];
  }
  // (a chat that answered is not a "run"; the Renovate review reports through renovateFinished instead)
  const agent = after.kind !== 'chat' && after.kind !== 'renovate';
  if (agent && before?.status === 'running' && after.status === 'done') {
    return [{ ...ctx, kind: 'claude-done', tone: 'success', title: 'Claude finished', detail: after.title }];
  }
  if (before && before.status !== 'failed' && after.status === 'failed') {
    return [{ ...ctx, kind: 'claude-failed', tone: 'critical', title: 'Claude run failed', detail: after.title }];
  }
  return [];
}

/** The Renovate review ended: what it merged is what disappeared from the open list, what is left needs a person. */
export function renovateFinished(projectName: string, projectId: string, sessionId: string, before: RenovatePr[], after: RenovatePr[]): Notice {
  const merged = before.filter((p) => !after.some((a) => a.number === p.number)).length;
  const left = after.length;
  return {
    kind: 'renovate-done',
    tone: left > 0 ? 'warning' : 'success',
    title: 'Renovate review finished',
    detail: `${merged} merged, ${left === 0 ? 'nothing left' : `${left} need you`}`,
    subject: projectName,
    projectId,
    projectTab: 'work',
    sessionId,
  };
}

// ---- what the user is looking at ----------------------------------------------------

/**
 * Is the thing this notice is about on screen right now? (The caller also checks that the browser tab is
 * visible.) A work item notice is "in view" when its tab is open — PR events on the PR tab, builds on the
 * Build tab, a session when that very session is the one shown.
 */
export function isInView(n: Notice, view: ViewState, sessions: AgentSession[]): boolean {
  if (n.workId) {
    if (view.workId !== n.workId || view.tab !== n.tab) return false;
    if (n.tab !== 'agents' || !n.sessionId) return true;
    const mine = sessions.filter((s) => s.workId === n.workId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const shown = mine.find((s) => s.id === view.sessionId) ?? mostRelevantSession(mine);
    return shown?.id === n.sessionId;
  }
  if (n.projectId) return view.page === 'projects' && view.projectId === n.projectId && (view.projectTab ?? 'overview') === n.projectTab;
  return n.sessionId === GLOBAL_SESSION_ID && view.workId === null && !view.page; // the "Ask Cortex" chat
}
