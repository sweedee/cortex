import type { CortexState, WorkItem } from '../model/types';
import { pipelines } from './seed/pipelines';
import { prs } from './seed/prs';
import { planFor, seedSessions } from './seed/sessions';
import { backlogTickets, tickets } from './seed/tickets';

export const ME = 'Sven Weber';

const stopped = { status: 'stopped' as const, logs: [] };

const work: WorkItem[] = [
  {
    id: 'CTX-1423',
    kind: 'ticket',
    title: tickets['CTX-1423'].summary,
    repo: 'ingest-gateway',
    ticket: tickets['CTX-1423'],
    worktree: {
      repo: 'ingest-gateway',
      path: '~/wt/ingest-gateway/CTX-1423',
      branch: 'feature/CTX-1423-webhook-retry',
      baseBranch: 'main',
      ahead: 6,
      behind: 2,
      dirtyFiles: 0,
    },
    pr: prs['CTX-1423'],
    pipeline: pipelines['CTX-1423'],
    app: stopped,
    updatedAt: '2026-11-11T08:47:00Z',
  },
  {
    id: 'CTX-1431',
    kind: 'ticket',
    title: tickets['CTX-1431'].summary,
    repo: 'console-ui',
    ticket: tickets['CTX-1431'],
    worktree: {
      repo: 'console-ui',
      path: '~/wt/console-ui/CTX-1431',
      branch: 'bugfix/CTX-1431-tile-flicker',
      baseBranch: 'main',
      ahead: 1,
      behind: 0,
      dirtyFiles: 3,
    },
    app: {
      status: 'running',
      port: 3431,
      url: '/preview/index.html?work=CTX-1431',
      logs: ['$ npm run dev -- --port 3431', '  VITE ready in 412 ms', '  ➜  Local: http://localhost:3431/'],
    },
    updatedAt: '2026-11-11T09:14:00Z',
  },
  {
    id: 'review-482',
    kind: 'review',
    title: 'Review #482 · Evict query cache entries by tenant',
    repo: 'query-service',
    pr: prs['review-482'],
    pipeline: pipelines['review-482'],
    app: stopped,
    updatedAt: '2026-11-11T07:20:00Z',
  },
  {
    id: 'CTX-1398',
    kind: 'ticket',
    title: tickets['CTX-1398'].summary,
    repo: 'ingest-gateway',
    ticket: tickets['CTX-1398'],
    worktree: {
      repo: 'ingest-gateway',
      path: '~/wt/ingest-gateway/CTX-1398',
      branch: 'feature/CTX-1398-tenant-rate-limit',
      baseBranch: 'main',
      ahead: 9,
      behind: 0,
      dirtyFiles: 0,
    },
    pr: prs['CTX-1398'],
    pipeline: pipelines['CTX-1398'],
    app: stopped,
    updatedAt: '2026-11-10T16:30:00Z',
  },
  {
    id: 'adhoc-flaky-e2e',
    kind: 'adhoc',
    title: 'Investigate flaky checkout e2e on main',
    repo: 'console-ui',
    app: stopped,
    updatedAt: '2026-11-11T08:10:00Z',
  },
  {
    id: 'CTX-1440',
    kind: 'ticket',
    title: tickets['CTX-1440'].summary,
    repo: 'console-ui',
    ticket: tickets['CTX-1440'],
    app: stopped,
    updatedAt: '2026-11-09T14:00:00Z',
  },
];

// Work that already went through a plan agent gets its plan attached.
for (const w of work) {
  if (seedSessions.some((s) => s.workId === w.id && s.kind === 'plan' && s.status === 'done')) {
    w.planMd = planFor(w);
  }
}

/**
 * Seed timestamps are written as if "now" were REFERENCE_NOW. Shift them all so
 * relative times ("12m ago") look right whenever the prototype is opened.
 */
const REFERENCE_NOW = Date.parse('2026-11-11T09:20:00Z');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

function rebase<T>(value: T, offset = Date.now() - REFERENCE_NOW): T {
  if (typeof value === 'string') {
    return (ISO.test(value) ? new Date(Date.parse(value) + offset).toISOString() : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => rebase(v, offset)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, offset)])) as T;
  }
  return value;
}

export const initialState: CortexState = rebase({
  me: ME,
  work,
  sessions: seedSessions,
  backlog: backlogTickets,
  todos: [], // loaded from localStorage by initTodos()
  view: { workId: null, tab: 'ticket' },
  busy: {},
});
