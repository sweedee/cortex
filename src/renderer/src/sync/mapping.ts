/**
 * Pure mapping from live integration state (main's `claude:state`, `app:state`, `test:state`)
 * to item data patches and the notices worth raising. `live.ts` applies them; tests cover them.
 */
import { toolSummary, type ClaudeSessionSummary } from '../../../shared/integrations/claude';
import type { GitStatus } from '../../../shared/integrations/git';
import type { GhPullRequest, GhStatusCheck } from '../../../shared/integrations/github';
import { summarizeIssue, type JiraIssue } from '../../../shared/integrations/jira';
import type { AppState, TestState } from '../../../shared/integrations/runners';
import type { AgentData, AppData, Notice, PrData, ProjectData, TestRunData, TicketData, WorktreeData } from '../domain';

export type NoticeSpec = Pick<Notice, 'text' | 'tone'>;
export interface Mapped<D> {
  patch: Partial<D>;
  notice?: NoticeSpec;
}

/** Context window used for `usage.contextPct` (Claude Code's default window). */
export const CONTEXT_WINDOW = 200_000;

const firstLine = (s: string | undefined, max = 90) => {
  const l = s?.trim().split(/\r?\n/).find((x) => x.trim())?.trim();
  return l ? (l.length > max ? l.slice(0, max - 1) + '…' : l) : undefined;
};

/** Claude session status → agent bubble status (given the bubble's previous one). */
export function agentStatusOf(s: ClaudeSessionSummary, prev: AgentData['status']): AgentData['status'] {
  switch (s.status) {
    case 'starting':
    case 'running':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'idle':
      // the turn is over and the process waits for the next message: done, unless it was interrupted
      return s.activity === 'Interrupted' ? 'idle' : 'done';
    case 'done':
      // no process attached any more: stopped mid-turn = idle, else stays what it was
      return prev === 'running' || prev === 'waiting' ? 'idle' : prev === 'failed' ? 'done' : prev;
    case 'failed':
      return 'failed';
  }
}

/** `claude:state` → agent data patch + notice for the transition. */
export function mapClaudeState(s: ClaudeSessionSummary, prev: AgentData, title: string, now = Date.now()): Mapped<AgentData> {
  const status = agentStatusOf(s, prev.status);
  const ended = status === 'done' || status === 'failed' || status === 'idle';
  const patch: Partial<AgentData> = {
    status,
    sessionId: s.sessionId ?? prev.sessionId,
    model: s.model ?? prev.model,
    cwd: s.cwd || prev.cwd,
    lastActivity: s.activity ?? (ended ? (firstLine(s.lastText) ?? prev.lastActivity) : prev.lastActivity),
    pendingQuestion: s.pendingQuestion
      ? { toolUseId: s.pendingQuestion.toolUseId, questions: s.pendingQuestion.questions.map((q) => ({ question: q.question, header: q.header || undefined, options: q.options, multiSelect: q.multiSelect })) }
      : undefined,
    pendingPermissions: s.pendingPermissions.length ? s.pendingPermissions.map((p) => ({ requestId: p.requestId, toolName: p.toolName, summary: firstLine(toolSummary(p.input), 120) })) : undefined,
    error: status === 'failed' ? (s.error ?? 'failed') : undefined,
    usage: { contextPct: Math.min(100, Math.round((s.usage.contextTokens / CONTEXT_WINDOW) * 100)), costUsd: s.usage.costUsd, turns: s.usage.turns },
    startedAt: prev.startedAt ?? now,
    endedAt: ended ? (prev.endedAt && !['running', 'waiting'].includes(prev.status) ? prev.endedAt : now) : undefined,
  };

  let notice: NoticeSpec | undefined;
  if (status === 'waiting' && prev.status !== 'waiting') {
    const q = s.pendingQuestion?.questions[0];
    const perm = s.pendingPermissions[0];
    notice = q
      ? { text: `${title} asks: ${firstLine(q.question, 80)}`, tone: 'warning' }
      : { text: `${title} needs permission${perm ? ` to use ${perm.toolName}` : ''}`, tone: 'warning' };
  } else if (status === 'failed' && prev.status !== 'failed') {
    notice = { text: `${title} failed${s.error ? `: ${firstLine(s.error, 80)}` : ''}`, tone: 'critical' };
  } else if (status === 'done' && (prev.status === 'running' || prev.status === 'waiting')) {
    notice = { text: `${title} finished — ready for your review`, tone: 'success' };
  }
  return { patch, notice };
}

const portOf = (url: string | undefined) => {
  const m = url?.match(/:(\d{2,5})(?:\/|$)/);
  return m ? Number(m[1]) : undefined;
};

/** `app:state` → app data patch + notice (a crash is critical). */
export function mapAppState(s: AppState, prev: AppData): Mapped<AppData> {
  const state: AppData['state'] = s.status === 'exited' ? 'stopped' : s.status;
  const url = s.url ?? prev.url;
  const patch: Partial<AppData> = { state, url, port: portOf(url) ?? prev.port, procId: s.id, cwd: s.cwd || prev.cwd };
  const notice: NoticeSpec | undefined =
    state === 'crashed' && prev.state !== 'crashed'
      ? { text: `Crashed${s.code != null ? ` (exit code ${s.code})` : ''}${s.error ? `: ${firstLine(s.error, 80)}` : ''}`, tone: 'critical' }
      : undefined;
  return { patch, notice };
}

/** `test:state` → test run data patch + notice (failed = critical, passed = success). */
export function mapTestState(s: TestState, prev: TestRunData): Mapped<TestRunData> {
  const state: TestRunData['state'] = s.status === 'error' ? (s.error === 'stopped' ? 'stopped' : 'failed') : s.status;
  const summary = s.summary ? { passed: s.summary.passed, failed: s.summary.failed, skipped: s.summary.skipped } : state === 'running' ? undefined : prev.summary;
  const patch: Partial<TestRunData> = {
    state,
    summary: state === 'running' ? undefined : summary,
    procId: s.id,
    startedAt: s.startedAt,
    endedAt: s.finishedAt,
    ...(state === 'running' && prev.state !== 'running' ? { outputTail: undefined } : {}),
  };
  let notice: NoticeSpec | undefined;
  if (prev.state === 'running' || prev.state === 'idle') {
    if (state === 'failed') {
      const n = s.summary?.failed;
      notice = { text: n ? `${n} test${n === 1 ? '' : 's'} failed` : s.error ? `Tests could not run: ${firstLine(s.error, 80)}` : `Tests failed (exit code ${s.code ?? '?'})`, tone: 'critical' };
    } else if (state === 'passed') {
      notice = { text: s.summary ? `All ${s.summary.passed} tests passed` : 'Tests passed', tone: 'success' };
    }
  }
  return { patch, notice };
}

/** Keep the last `max` characters of a log, cut at a line start. */
export function tailOf(text: string, max = 8000): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < 400 ? cut.slice(nl + 1) : cut;
}

/** What startup reconciliation does with an item main does not know (or no longer runs). */
export const STALE = {
  agent: (d: AgentData): Partial<AgentData> | null => (d.status === 'running' || d.status === 'waiting' ? { status: 'idle', pendingQuestion: undefined, pendingPermissions: undefined, lastActivity: 'Stopped (app restarted)' } : null),
  app: (d: AppData): Partial<AppData> | null => (d.state === 'running' || d.state === 'starting' ? { state: 'stopped' } : null),
  testrun: (d: TestRunData): Partial<TestRunData> | null => (d.state === 'running' ? { state: 'stopped' } : null),
};

// ---- background refresher: remote state → ring caches ------------------------------------

const checkOutcome = (c: GhStatusCheck): 'passed' | 'failed' | 'pending' | 'skipped' => {
  if (c.__typename === 'StatusContext') return c.state === 'SUCCESS' ? 'passed' : c.state === 'FAILURE' || c.state === 'ERROR' ? 'failed' : 'pending';
  if (c.status !== 'COMPLETED') return 'pending';
  if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(c.conclusion)) return 'failed';
  return c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL' ? 'skipped' : 'passed';
};

/** `gh pr view` → the PR item's cached fields (state, review, mergeable, checks rollup with counts). */
export function prPatch(pr: GhPullRequest): Partial<PrData> {
  const checks = pr.statusCheckRollup ?? [];
  const n = { passed: 0, failed: 0, pending: 0 };
  for (const c of checks) {
    const o = checkOutcome(c);
    if (o !== 'skipped') n[o]++;
  }
  const latest = pr.latestReviews ?? [];
  return {
    state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
    isDraft: pr.isDraft,
    author: pr.author?.login ? (pr.author.is_bot && !pr.author.login.endsWith('[bot]') ? `${pr.author.login.replace(/^app\//, '')}[bot]` : pr.author.login) : undefined,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    reviewDecision: pr.reviewDecision || undefined,
    reviews: { approved: latest.filter((r) => r.state === 'APPROVED').length, requested: (pr.reviewRequests ?? []).length },
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus || undefined,
    checks: checks.length ? { state: n.failed ? 'failure' : n.pending ? 'pending' : 'success', ...n } : { state: 'none' },
    additions: pr.additions,
    deletions: pr.deletions,
  };
}

/** Polls faster while checks run. */
export const prChecksRunning = (d: PrData) => d.state === 'open' && d.checks?.state === 'pending';

/** `jira view` → the ticket's cached fields and its title (the summary). */
export function ticketPatch(issue: JiraIssue): { patch: Partial<TicketData>; title: string } {
  const s = summarizeIssue(issue);
  return {
    title: s.summary,
    patch: {
      status: s.status,
      ...(s.statusCategory !== 'undefined' ? { statusCategory: s.statusCategory } : {}),
      type: s.type || undefined,
      priority: s.priority || undefined,
      assignee: s.assignee ?? undefined,
      sprint: s.sprint,
      points: s.storyPoints,
    } as Partial<TicketData>,
  };
}

/**
 * Git numbers for the worktree ring: dirty / changed files from `git status`; ahead / behind
 * relative to the base branch when known (else the upstream's numbers).
 */
export function worktreeGitPatch(status: GitStatus, vsBase: { ahead: number; behind: number } | null, now = Date.now()): Partial<WorktreeData> {
  return {
    git: {
      ahead: vsBase?.ahead ?? status.ahead,
      behind: vsBase?.behind ?? status.behind,
      dirty: status.dirty,
      changedFiles: status.files.filter((f) => f.kind !== 'ignored').length,
      checkedAt: now,
    },
    ...(status.branch ? { branch: status.branch } : {}),
  };
}

/** Open / Renovate PR counts for the project ring. */
export const projectStatsPatch = (prev: ProjectData, openPrs: number, renovatePrs: number): Partial<ProjectData> => ({ stats: { ...prev.stats, openPrs, renovatePrs } });

/** Did a patch change anything (so unchanged refreshes don't touch the store / file)? */
export function changes<D extends object>(prev: D, patch: Partial<D>): boolean {
  return Object.entries(patch).some(([k, v]) => {
    const old = (prev as Record<string, unknown>)[k];
    if (k === 'git' && v && old) {
      const { checkedAt: _a, ...a } = v as Record<string, unknown>;
      const { checkedAt: _b, ...b } = old as Record<string, unknown>;
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return JSON.stringify(old) !== JSON.stringify(v);
  });
}
