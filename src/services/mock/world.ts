/**
 * The mocked "outside world": what Jira, GitHub, Jenkins, git, Claude and the dev
 * servers would hold. Mock services read and mutate this; the app never touches it
 * directly — it only sees what the services return, in the real tools' formats.
 *
 * It is kept in the UI's domain shapes because that is how the seed data is
 * authored; `serialize.ts` turns it into tool-shaped DTOs on the way out.
 */
import { pipelines } from '../../mock/seed/pipelines';
import { prs } from '../../mock/seed/prs';
import { seedSessions } from '../../mock/seed/sessions';
import { backlogTickets, tickets } from '../../mock/seed/tickets';
import type { AgentSession, Pipeline, PullRequest, Ticket, WorkItem, Worktree } from '../../model/types';
import type { DevServerInfo, WorkRef, Workspace } from '../types';

export const ME = { login: 'sven-weber', name: 'Sven Weber' };

/** Simulated latency of a tool call. */
export const delay = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms + Math.random() * 60));

// ---- seed timestamps → relative to now ---------------------------------------

/** Seed timestamps are written as if "now" were this instant; shift them so "12m ago" always looks right. */
const REFERENCE_NOW = Date.parse('2026-11-11T09:20:00Z');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

function rebase<T>(value: T, offset = Date.now() - REFERENCE_NOW): T {
  if (typeof value === 'string') return (ISO.test(value) ? new Date(Date.parse(value) + offset).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v) => rebase(v, offset)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, offset)])) as T;
  }
  return value;
}

// ---- state -------------------------------------------------------------------

export interface WorldSession {
  session: AgentSession; // messages = stored transcript
  running: boolean;
}

const worktree = (repo: string, key: string, branch: string, ahead: number, behind: number, dirtyFiles: number): Worktree => ({
  repo,
  path: `~/wt/${repo}/${key}`,
  branch,
  baseBranch: 'main',
  ahead,
  behind,
  dirtyFiles,
});

export const world = rebase({
  tickets: [...Object.values(tickets), ...backlogTickets] as Ticket[],
  worktrees: [
    worktree('ingest-gateway', 'CTX-1423', 'feature/CTX-1423-webhook-retry', 6, 2, 0),
    worktree('console-ui', 'CTX-1431', 'bugfix/CTX-1431-tile-flicker', 1, 0, 3),
    worktree('ingest-gateway', 'CTX-1398', 'feature/CTX-1398-tenant-rate-limit', 9, 0, 0),
  ] as Worktree[],
  /** pull requests, per repository */
  prs: [
    { repo: 'ingest-gateway', pr: prs['CTX-1423'] },
    { repo: 'ingest-gateway', pr: prs['CTX-1398'] },
    { repo: 'query-service', pr: prs['review-482'] },
  ] as { repo: string; pr: PullRequest }[],
  /** latest build per repository + branch */
  builds: [
    { repo: 'ingest-gateway', pipeline: pipelines['CTX-1423'] },
    { repo: 'ingest-gateway', pipeline: pipelines['CTX-1398'] },
    { repo: 'query-service', pipeline: pipelines['review-482'] },
  ] as { repo: string; pipeline: Pipeline }[],
  sessions: seedSessions.map((session) => ({ session, running: session.status === 'running' })) as WorldSession[],
  devServers: {
    'CTX-1431': {
      status: 'running',
      port: 3431,
      url: '/preview/index.html?work=CTX-1431&title=' + encodeURIComponent(tickets['CTX-1431'].summary),
      logs: ['$ npm run dev -- --port 3431', '> console-ui@0.0.0 dev', '  VITE ready in 412 ms', '  ➜  Local: http://localhost:3431/'],
    },
  } as Record<string, DevServerInfo>,
  /** Cortex's own persisted state (see WorkspaceService) */
  workspace: {
    work: [
      { id: 'CTX-1423', kind: 'ticket', title: tickets['CTX-1423'].summary, repo: 'ingest-gateway', ticketKey: 'CTX-1423', worktreePath: '~/wt/ingest-gateway/CTX-1423', createdAt: '2026-11-10T12:50:00Z' },
      { id: 'CTX-1431', kind: 'ticket', title: tickets['CTX-1431'].summary, repo: 'console-ui', ticketKey: 'CTX-1431', worktreePath: '~/wt/console-ui/CTX-1431', createdAt: '2026-11-11T08:15:00Z' },
      { id: 'review-482', kind: 'review', title: 'Review #482 · Evict query cache entries by tenant', repo: 'query-service', prNumber: 482, createdAt: '2026-11-11T07:20:00Z' },
      { id: 'CTX-1398', kind: 'ticket', title: tickets['CTX-1398'].summary, repo: 'ingest-gateway', ticketKey: 'CTX-1398', worktreePath: '~/wt/ingest-gateway/CTX-1398', createdAt: '2026-11-07T10:00:00Z' },
      { id: 'adhoc-flaky-e2e', kind: 'adhoc', title: 'Investigate flaky checkout e2e on main', repo: 'console-ui', createdAt: '2026-11-11T08:00:00Z' },
      { id: 'CTX-1440', kind: 'ticket', title: tickets['CTX-1440'].summary, repo: 'console-ui', ticketKey: 'CTX-1440', createdAt: '2026-11-09T14:00:00Z' },
    ],
    sessions: seedSessions.map(({ id, workId, kind, title, startedAt }) => ({ id, workId, kind, title, startedAt })),
  } as Workspace,
});

// ---- lookups the mock services share -------------------------------------------

export const findPr = (repo: string, number: number) => world.prs.find((p) => p.repo === repo && p.pr.number === number);
export const findBuild = (repo: string, branch: string) => world.builds.find((b) => b.repo === repo && b.pipeline.branch === branch);
export const findWorktree = (path: string | undefined) => world.worktrees.find((w) => w.path === path);

/**
 * The seed generators (draft PR, queued build, agent script, plan) want a WorkItem.
 * Assemble one from the world for a workspace entry.
 */
export function workItemOf(ref: WorkRef): WorkItem {
  const wt = findWorktree(ref.worktreePath);
  const pr = ref.prNumber ? findPr(ref.repo, ref.prNumber)?.pr : world.prs.find((p) => p.repo === ref.repo && p.pr.sourceBranch === wt?.branch)?.pr;
  const branch = wt?.branch ?? pr?.sourceBranch;
  return {
    id: ref.id,
    kind: ref.kind,
    title: ref.title,
    repo: ref.repo,
    ticket: world.tickets.find((t) => t.key === ref.ticketKey),
    worktree: wt,
    pr,
    pipeline: branch ? findBuild(ref.repo, branch)?.pipeline : undefined,
    app: world.devServers[ref.id] ?? { status: 'stopped', logs: [] },
    updatedAt: ref.createdAt,
  };
}

export const workItemById = (workId: string | null): WorkItem | undefined => {
  const ref = world.workspace.work.find((w) => w.id === workId);
  return ref && workItemOf(ref);
};

/** Which workspace entry owns a branch (to give generated PRs/builds some context). */
export function workItemByBranch(repo: string, branch: string): WorkItem | undefined {
  const wt = world.worktrees.find((w) => w.repo === repo && w.branch === branch);
  const ref = world.workspace.work.find((w) => w.repo === repo && wt && w.worktreePath === wt.path);
  return ref && workItemOf(ref);
}
