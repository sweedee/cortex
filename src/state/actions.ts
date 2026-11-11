/**
 * Everything the UI can "do". Each action talks to a mocked backend: it waits
 * a little, then mutates the store. Long-running things (agents, CI builds)
 * are simulated with timers so the UI updates live.
 */
import type {
  AgentKind,
  AgentSession,
  PrState,
  ReviewThread,
  SessionMessage,
  TicketStatus,
  WorkItem,
  WorkTab,
} from '../model/types';
import { makeQueuedPipeline } from '../mock/seed/pipelines';
import { makeDraftPr } from '../mock/seed/prs';
import { agentScript, cannedReply, MODEL, planFor } from '../mock/seed/sessions';
import { getState, patchSession, patchWork, setBusy, setState } from './store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;
const findWork = (id: string) => getState().work.find((w) => w.id === id);

async function busy<T>(workId: string, action: string, fn: () => Promise<T>): Promise<T> {
  setBusy(workId, action, true);
  try {
    return await fn();
  } finally {
    setBusy(workId, action, false);
  }
}

// ---- navigation ------------------------------------------------------------

/** Tab that is most useful to land on for a work item. */
export function defaultTab(w: WorkItem): WorkTab {
  if (w.kind === 'review') return 'review';
  if (w.ticket) return 'ticket';
  return 'agents';
}

export function selectWork(workId: string | null, tab?: WorkTab, sessionId?: string) {
  setState((s) => {
    const w = s.work.find((x) => x.id === workId);
    return {
      ...s,
      view: {
        workId: w ? w.id : null,
        tab: tab ?? (w ? (s.view.workId === w.id ? s.view.tab : defaultTab(w)) : 'ticket'),
        sessionId: sessionId ?? (s.view.workId === workId ? s.view.sessionId : undefined),
      },
    };
  });
}

export const setTab = (tab: WorkTab) => setState((s) => ({ ...s, view: { ...s.view, tab } }));

export const openSession = (sessionId: string) =>
  setState((s) => ({ ...s, view: { ...s.view, tab: 'agents', sessionId } }));

// ---- work lifecycle --------------------------------------------------------

export function startWorkOnTicket(ticketKey: string) {
  const ticket = getState().backlog.find((t) => t.key === ticketKey);
  if (!ticket) return;
  const item: WorkItem = {
    id: ticket.key,
    kind: 'ticket',
    title: ticket.summary,
    repo: ticket.type === 'Bug' ? 'ingest-gateway' : 'console-ui',
    ticket,
    app: { status: 'stopped', logs: [] },
    updatedAt: now(),
  };
  setState((s) => ({
    ...s,
    backlog: s.backlog.filter((t) => t.key !== ticketKey),
    work: [item, ...s.work],
    view: { workId: item.id, tab: 'ticket' },
  }));
}

export function startAdhocWork(title: string, repo: string) {
  const item: WorkItem = {
    id: uid('adhoc'),
    kind: 'adhoc',
    title,
    repo,
    app: { status: 'stopped', logs: [] },
    updatedAt: now(),
  };
  setState((s) => ({ ...s, work: [item, ...s.work], view: { workId: item.id, tab: 'agents' } }));
}

export function archiveWork(workId: string) {
  setState((s) => ({
    ...s,
    work: s.work.filter((w) => w.id !== workId),
    sessions: s.sessions.filter((x) => x.workId !== workId),
    view: s.view.workId === workId ? { workId: null, tab: 'ticket' } : s.view,
  }));
}

export function transitionTicket(workId: string, status: TicketStatus) {
  patchWork(workId, (w) => (w.ticket ? { ticket: { ...w.ticket, status, updatedAt: now() } } : {}));
}

// ---- git -------------------------------------------------------------------

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');

export function createWorktree(workId: string) {
  return busy(workId, 'worktree', async () => {
    await sleep(1400);
    patchWork(workId, (w) => {
      const prefix = w.ticket?.type === 'Bug' ? 'bugfix' : w.ticket ? 'feature' : 'chore';
      const name = w.ticket ? `${w.ticket.key}-${slug(w.ticket.summary)}` : slug(w.title);
      return {
        worktree: {
          repo: w.repo,
          path: `~/wt/${w.repo}/${w.ticket?.key ?? slug(w.title)}`,
          branch: `${prefix}/${name}`,
          baseBranch: 'main',
          ahead: 0,
          behind: 0,
          dirtyFiles: 0,
        },
        ticket: w.ticket && w.ticket.status === 'To Do' ? { ...w.ticket, status: 'In Progress' } : w.ticket,
      };
    });
  });
}

export function syncWithBase(workId: string) {
  return busy(workId, 'sync', async () => {
    await sleep(1200);
    patchWork(workId, (w) => (w.worktree ? { worktree: { ...w.worktree, behind: 0 } } : {}));
  });
}

// ---- Claude sessions -------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setInterval>>();

const AGENT_TITLES: Record<AgentKind, string> = {
  plan: 'Plan',
  implement: 'Implement',
  review: 'Self-review',
  'fix-ci': 'Fix CI',
  chat: 'Chat',
};

function appendMessage(sessionId: string, message: SessionMessage) {
  patchSession(sessionId, (x) => ({ messages: [...x.messages, message] }));
}

/** Kicks off a (scripted) agent on a work item and opens its session. */
export function launchAgent(workId: string, kind: AgentKind, navigate = true): string | undefined {
  const work = findWork(workId);
  if (!work) return;
  const script = kind === 'chat' ? [] : agentScript(kind, work);
  const session: AgentSession = {
    id: uid('s'),
    workId,
    kind,
    title: `${AGENT_TITLES[kind]} · ${work.ticket?.key ?? work.title}`,
    status: kind === 'chat' ? 'waiting' : 'running',
    model: MODEL,
    startedAt: now(),
    activity: kind === 'chat' ? undefined : 'Starting…',
    messages: [],
  };
  setState((s) => ({
    ...s,
    sessions: [...s.sessions, session],
    view: navigate ? { workId, tab: 'agents', sessionId: session.id } : s.view,
  }));
  if (kind === 'chat') return session.id;

  let i = 0;
  const timer = setInterval(() => {
    const step = script[i++];
    if (!step) {
      clearInterval(timer);
      timers.delete(session.id);
      finishAgent(session.id, workId, kind);
      return;
    }
    appendMessage(session.id, { ...step.message, id: uid('m'), at: now() } as SessionMessage);
    patchSession(session.id, () => ({ activity: step.activity }));
  }, 1100);
  timers.set(session.id, timer);
  return session.id;
}

/** Side effects an agent has on the rest of the work item once it is done. */
function finishAgent(sessionId: string, workId: string, kind: AgentKind) {
  patchSession(sessionId, () => ({ status: 'done', activity: undefined }));
  patchWork(workId, (w) => {
    switch (kind) {
      case 'plan':
        return { planMd: planFor(w) };
      case 'implement':
        return w.worktree
          ? { worktree: { ...w.worktree, ahead: w.worktree.ahead + 3, dirtyFiles: 0 } }
          : {};
      case 'fix-ci':
        return w.worktree ? { worktree: { ...w.worktree, ahead: w.worktree.ahead + 1 } } : {};
      default:
        return {};
    }
  });
  // A CI fix pushes a commit, which triggers a new build.
  if (kind === 'fix-ci') void runPipeline(workId);
}

export function stopSession(sessionId: string) {
  const timer = timers.get(sessionId);
  if (timer) clearInterval(timer);
  timers.delete(sessionId);
  patchSession(sessionId, () => ({ status: 'waiting', activity: 'Interrupted — waiting for input' }));
}

/** Sends a user message to a session; the assistant "streams" a canned reply. */
export async function sendMessage(sessionId: string, text: string) {
  const session = getState().sessions.find((x) => x.id === sessionId);
  if (!session || !text.trim()) return;
  const work = session.workId ? (findWork(session.workId) ?? null) : null;
  appendMessage(sessionId, { id: uid('m'), role: 'user', at: now(), text });
  patchSession(sessionId, () => ({ status: 'running', activity: 'Thinking…' }));
  await sleep(900);

  const reply = cannedReply(text, work);
  const id = uid('m');
  appendMessage(sessionId, { id, role: 'assistant', at: now(), text: '' });
  const words = reply.split(/(?<=\s)/);
  for (let i = 0; i < words.length; i += 3) {
    await sleep(45);
    const partial = words.slice(0, i + 3).join('');
    patchSession(sessionId, (x) => ({
      messages: x.messages.map((m) => (m.id === id && m.role === 'assistant' ? { ...m, text: partial } : m)),
    }));
  }
  patchSession(sessionId, () => ({ status: 'waiting', activity: undefined }));
}

// ---- pull requests ---------------------------------------------------------

export function createPr(workId: string) {
  return busy(workId, 'pr', async () => {
    await sleep(1500);
    const { me } = getState();
    patchWork(workId, (w) => ({
      pr: makeDraftPr(w, me),
      ticket: w.ticket ? { ...w.ticket, status: 'In Review' } : w.ticket,
    }));
    void runPipeline(workId);
  });
}

const patchPr = (workId: string, patch: (pr: NonNullable<WorkItem['pr']>) => Partial<NonNullable<WorkItem['pr']>>) =>
  patchWork(workId, (w) => (w.pr ? { pr: { ...w.pr, ...patch(w.pr), updatedAt: now() } } : {}));

export const markPrReady = (workId: string) => patchPr(workId, () => ({ state: 'open' }));

export function mergePr(workId: string) {
  return busy(workId, 'merge', async () => {
    await sleep(1600);
    patchPr(workId, () => ({ state: 'merged' }));
    transitionTicket(workId, 'Done');
  });
}

/**
 * Adds a comment. Pass `threadId` to reply to an existing thread, or an anchor
 * (`filePath`/`line`/`side`) to start a new one. Comments on a PR I am
 * reviewing stay `pending` until `submitReview` is called.
 */
export function addReviewComment(
  workId: string,
  target: { threadId: string } | { filePath: string; line: number; side: 'old' | 'new' },
  body: string,
) {
  const { me } = getState();
  patchPr(workId, (pr) => {
    const comment = { id: uid('c'), author: me, at: now(), body, pending: pr.reviewRequested || undefined };
    if ('threadId' in target) {
      return {
        threads: pr.threads.map((t) =>
          t.id === target.threadId ? { ...t, comments: [...t.comments, comment] } : t,
        ),
      };
    }
    const thread: ReviewThread = { id: uid('t'), ...target, resolved: false, comments: [comment] };
    return { threads: [...pr.threads, thread] };
  });
}

export function deleteReviewComment(workId: string, threadId: string, commentId: string) {
  patchPr(workId, (pr) => ({
    threads: pr.threads
      .map((t) => (t.id === threadId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t))
      .filter((t) => t.comments.length > 0),
  }));
}

export const resolveThread = (workId: string, threadId: string, resolved: boolean) =>
  patchPr(workId, (pr) => ({
    threads: pr.threads.map((t) => (t.id === threadId ? { ...t, resolved } : t)),
  }));

/** Publishes all pending comments together with a verdict. */
export function submitReview(workId: string, verdict: 'approve' | 'request-changes' | 'comment') {
  return busy(workId, 'review', async () => {
    await sleep(900);
    const { me } = getState();
    const reviewerState = verdict === 'approve' ? 'approved' : verdict === 'request-changes' ? 'changes-requested' : 'commented';
    patchPr(workId, (pr) => {
      const state: PrState =
        verdict === 'approve' ? 'approved' : verdict === 'request-changes' ? 'changes-requested' : pr.state;
      return {
        state,
        reviewers: pr.reviewers.map((r) => (r.name === me ? { ...r, state: reviewerState } : r)),
        threads: pr.threads.map((t) => ({
          ...t,
          comments: t.comments.map((c) => ({ ...c, pending: undefined })),
        })),
      };
    });
  });
}

// ---- CI --------------------------------------------------------------------

const pipelineRuns = new Map<string, number>();

/** Triggers a new Jenkins build and plays its stages through. */
export async function runPipeline(workId: string) {
  const work = findWork(workId);
  if (!work) return;
  const run = (pipelineRuns.get(workId) ?? 0) + 1;
  pipelineRuns.set(workId, run);
  const superseded = () => pipelineRuns.get(workId) !== run;

  const { me } = getState();
  const pipeline = makeQueuedPipeline(work, (work.pipeline?.buildNumber ?? 0) + 1, me);
  patchWork(workId, () => ({ pipeline }));
  await sleep(1200);

  for (let i = 0; i < pipeline.stages.length; i++) {
    if (superseded()) return;
    setStage(workId, i, 'running', 'running');
    await sleep(1600 + Math.random() * 1200);
    if (superseded()) return;
    setStage(workId, i, 'passed', i === pipeline.stages.length - 1 ? 'passed' : 'running');
  }
}

function setStage(workId: string, index: number, stage: 'running' | 'passed', overall: 'running' | 'passed') {
  patchWork(workId, (w) =>
    w.pipeline
      ? {
          pipeline: {
            ...w.pipeline,
            status: overall,
            stages: w.pipeline.stages.map((s, i) => (i === index ? { ...s, status: stage } : s)),
          },
        }
      : {},
  );
}

// ---- local app -------------------------------------------------------------

export function launchApp(workId: string, navigate = true) {
  const port = 3000 + Math.floor(Math.random() * 900);
  patchWork(workId, (w) => ({
    app: { status: 'starting', port, logs: [`$ npm run dev -- --port ${port}`, `> ${w.repo}@0.0.0 dev`] },
  }));
  if (navigate) selectWork(workId, 'preview');
  return busy(workId, 'app', async () => {
    await sleep(900);
    patchWork(workId, (w) => ({ app: { ...w.app, logs: [...w.app.logs, '  resolving dependencies…'] } }));
    await sleep(1300);
    patchWork(workId, (w) =>
      w.app.status === 'starting'
        ? {
            app: {
              ...w.app,
              status: 'running',
              url: `/preview/index.html?work=${encodeURIComponent(w.id)}&title=${encodeURIComponent(w.title)}`,
              logs: [...w.app.logs, '  VITE ready in 388 ms', `  ➜  Local: http://localhost:${port}/`],
            },
          }
        : {},
    );
  });
}

export const stopApp = (workId: string) =>
  patchWork(workId, (w) => ({
    app: { status: 'stopped', logs: [...w.app.logs, '^C', 'process exited'] },
  }));
