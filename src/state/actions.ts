/**
 * Everything the UI can "do". Views import from here and from the store — never from
 * src/services. An action is: call a service → `refreshWork` the affected parts.
 * Long-running things (agents, builds, app start-up) are followed by state/sync.ts.
 */
import type { AgentKind, AgentSession, CreatePrInput, SessionMessage, Ticket, TicketStatus, WorkItem, WorkTab } from '../model/types';
import { services } from '../services';
import { config } from '../services/config';
import { AGENT_TITLES, promptFor } from '../services/prompts';
import type { SessionRef, WorkRef } from '../services/types';
import { projectForLabels } from './projects';
import { getState, patchSession, patchWork, setBusy, setState } from './store';
import { blankSession, claudeChoice, projectBase, refreshWork, saveClaudeChoice, startedSessions, updateWorkspace } from './sync';
import { openQuestion } from '../model/session';
import type { ClaudeAnswers } from '../services/types';

const now = () => new Date().toISOString();
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

function addWork(ref: WorkRef, ticket: Ticket | undefined, tab: WorkTab) {
  updateWorkspace((w) => ({ ...w, work: [ref, ...w.work] }));
  const item: WorkItem = { id: ref.id, kind: ref.kind, title: ref.title, repo: ref.repo, ticket, app: { status: 'stopped', logs: [] }, updatedAt: ref.createdAt };
  setState((s) => ({
    ...s,
    backlog: s.backlog.filter((t) => t.key !== ref.ticketKey),
    work: [item, ...s.work],
    view: { workId: item.id, tab },
  }));
}

/** Puts an assigned Jira ticket on the board. */
export function startWorkOnTicket(ticketKey: string) {
  const ticket = getState().backlog.find((t) => t.key === ticketKey);
  if (!ticket) return;
  // which repository a ticket belongs to: by label, else the first configured one
  const repo = projectForLabels(ticket.labels);
  addWork({ id: ticket.key, kind: 'ticket', title: ticket.summary, repo, ticketKey: ticket.key, createdAt: now() }, ticket, 'ticket');
}

export function startAdhocWork(title: string, repo: string) {
  addWork({ id: `adhoc-${Date.now().toString(36)}`, kind: 'adhoc', title, repo, createdAt: now() }, undefined, 'agents');
}

/** Takes work off the board. Nothing is deleted in Jira / GitHub / git. */
export function archiveWork(workId: string) {
  for (const s of getState().sessions) {
    if (s.workId === workId && s.status === 'running') void services.claude.interrupt(s.id);
  }
  updateWorkspace((w) => ({ work: w.work.filter((x) => x.id !== workId), sessions: w.sessions.filter((x) => x.workId !== workId) }));
  setState((s) => ({
    ...s,
    work: s.work.filter((w) => w.id !== workId),
    sessions: s.sessions.filter((x) => x.workId !== workId),
    view: s.view.workId === workId ? { workId: null, tab: 'ticket' } : s.view,
  }));
}

// ---- Jira ------------------------------------------------------------------

export async function transitionTicket(workId: string, status: TicketStatus) {
  const key = findWork(workId)?.ticket?.key;
  if (!key) return;
  // show the new status right away; the refresh confirms it
  patchWork(workId, (w) => (w.ticket ? { ticket: { ...w.ticket, status } } : {}));
  await services.jira.transition(key, status);
  await refreshWork(workId, ['ticket']);
}

export async function addTicketComment(workId: string, body: string) {
  const key = findWork(workId)?.ticket?.key;
  if (!key || !body.trim()) return;
  await services.jira.addComment(key, body.trim());
  await refreshWork(workId, ['ticket']);
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
    const w = findWork(workId);
    if (!w || w.worktree) return;
    const prefix = w.ticket?.type === 'Bug' ? 'bugfix' : w.ticket ? 'feature' : 'chore';
    const name = w.ticket ? `${w.ticket.key}-${slug(w.ticket.summary)}` : slug(w.title);
    const project = getState().projects.find((p) => p.id === w.repo);
    const path = `${project?.worktreeRoot ?? `${config.worktreeRoot}/${w.repo}`}/${w.ticket?.key ?? slug(w.title)}`;

    await services.git.addWorktree(w.repo, { path, branch: `${prefix}/${name}`, base: project?.baseBranch ?? config.baseBranch });
    updateWorkspace((ws) => ({ ...ws, work: ws.work.map((r) => (r.id === workId ? { ...r, worktreePath: path } : r)) }));
    // starting to work on a ticket moves it along
    if (w.ticket?.status === 'To Do') await services.jira.transition(w.ticket.key, 'In Progress');
    await refreshWork(workId, ['git', 'ticket']);
  });
}

export function syncWithBase(workId: string) {
  return busy(workId, 'sync', async () => {
    const wt = findWork(workId)?.worktree;
    if (!wt) return;
    // wt.baseBranch is the parent's branch for stacked work. The rebase is pushed, which starts a new build.
    await services.git.rebase(wt.path, wt.baseBranch);
    await refreshWork(workId, ['git', 'ci']);
  });
}

// ---- Claude sessions -------------------------------------------------------

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

function appendUserMessage(sessionId: string, text: string) {
  const message: SessionMessage = { id: `u-${Date.now().toString(36)}`, role: 'user', at: now(), text };
  patchSession(sessionId, (x) => ({ messages: [...x.messages, message], status: 'running', activity: 'Thinking…' }));
}

/** Starts the Claude process of a session with its first prompt. */
function startClaude(session: AgentSession, prompt: string) {
  startedSessions.add(session.id);
  const cwd = session.workId ? findWork(session.workId)?.worktree?.path : undefined;
  void services.claude.start({ sessionId: session.id, cwd, prompt, kind: session.kind, workId: session.workId, model: session.model, effort: session.effort });
}

/** Model / effort for the next turn of a session; also the default for sessions started later. */
export function setSessionOptions(sessionId: string, options: { model?: string; effort?: string }) {
  const session = getState().sessions.find((x) => x.id === sessionId);
  if (!session || session.status === 'running') return;
  patchSession(sessionId, () => options);
  saveClaudeChoice({ model: options.model ?? session.model, effort: options.effort ?? session.effort ?? claudeChoice().effort });
}

/** Answers Claude's open AskUserQuestion; the answer comes back as the tool result (see state/sync.ts). */
export function answerQuestion(sessionId: string, toolUseId: string, answers: ClaudeAnswers) {
  return services.claude.answerQuestion(sessionId, toolUseId, answers);
}

/**
 * Creates a session on a work item and opens it. Agent kinds (plan, implement, …) start
 * working right away; a `chat` session waits for the first message.
 */
export function launchAgent(workId: string, kind: AgentKind, navigate = true): string | undefined {
  const work = findWork(workId);
  if (!work) return;
  const ref: SessionRef = { id: newId(), workId, kind, title: `${AGENT_TITLES[kind]} · ${work.ticket?.key ?? work.title}`, startedAt: now() };
  const session: AgentSession = { ...blankSession(ref), status: kind === 'chat' ? 'waiting' : 'running', activity: kind === 'chat' ? undefined : 'Starting…' };

  updateWorkspace((w) => ({ ...w, sessions: [...w.sessions, ref] }));
  setState((s) => ({
    ...s,
    sessions: [...s.sessions, session],
    view: navigate ? { workId, tab: 'agents', sessionId: session.id } : s.view,
  }));

  if (kind !== 'chat') {
    const prompt = promptFor(kind, work);
    // the transcript shows the gist of the prompt, not the whole briefing
    appendUserMessage(session.id, prompt.split('\n\n')[0]);
    patchSession(session.id, () => ({ activity: 'Starting…' }));
    startClaude(session, prompt);
  }
  return session.id;
}

export function stopSession(sessionId: string) {
  void services.claude.interrupt(sessionId);
}

/** Sends a user message; the answer arrives as Claude events (see state/sync.ts). */
export async function sendMessage(sessionId: string, text: string) {
  const session = getState().sessions.find((x) => x.id === sessionId);
  if (!session || !text.trim()) return;
  // while a question is open, a typed message is the answer (to the first question; the rest are skipped)
  const open = openQuestion(session.messages);
  if (open?.questions) {
    const [first, ...rest] = open.questions;
    await answerQuestion(sessionId, open.id, { [first.question]: text.trim(), ...Object.fromEntries(rest.map((q) => [q.question, '(skipped)'])) });
    return;
  }
  appendUserMessage(sessionId, text);
  if (startedSessions.has(sessionId)) await services.claude.send(sessionId, text, { model: session.model, effort: session.effort });
  else startClaude(session, text);
}

// ---- pull requests ---------------------------------------------------------

/** repo + PR number of a work item, for the GitHub calls. */
function prOf(workId: string) {
  const w = findWork(workId);
  return w?.pr ? { work: w, repo: w.repo, number: w.pr.number, pr: w.pr } : undefined;
}

export const openCreatePrDialog = (workId: string) => setState((s) => ({ ...s, dialog: { kind: 'create-pr', workId } }));
export const closeDialog = () => setState((s) => ({ ...s, dialog: null }));

/** Opens a PR for the work's branch with the values of the create dialog. A base other than the default makes it a stacked PR. */
export function createPr(workId: string, input: CreatePrInput) {
  return busy(workId, 'pr', async () => {
    const w = findWork(workId);
    if (!w?.worktree || w.pr) return;
    const { title, body, base, draft, reviewers } = input;
    await services.github.createPullRequest(w.repo, { head: w.worktree.branch, base, title: title.trim(), body, draft, reviewers: reviewers.length ? reviewers : undefined });
    // from now on the worktree is compared with (and rebased onto) the branch it was opened against
    const stacked = base !== projectBase(w.repo);
    updateWorkspace((ws) => ({ ...ws, work: ws.work.map((r) => (r.id === workId ? { ...r, baseBranch: stacked ? base : undefined } : r)) }));
    if (w.ticket && w.ticket.status !== 'Done') await services.jira.transition(w.ticket.key, 'In Review');
    await refreshWork(workId, ['git', 'pr', 'ci', 'ticket']);
  });
}

/** Points a stacked PR at the default branch once its parent PR is merged (merging does not retarget it). */
export function retargetPr(workId: string) {
  return busy(workId, 'retarget', async () => {
    const t = prOf(workId);
    if (!t) return;
    await services.github.setBase(t.repo, t.number, projectBase(t.repo));
    updateWorkspace((ws) => ({ ...ws, work: ws.work.map((r) => (r.id === workId ? { ...r, baseBranch: undefined } : r)) }));
    await refreshWork(workId, ['git', 'pr']);
  });
}

/**
 * Posts the AI-review trigger comment. The bot answers some seconds later; the PR shows it as a pending
 * reviewer meanwhile and sync.ts keeps polling until its review arrives.
 */
export function requestAiReview(workId: string) {
  return busy(workId, 'ai-review', async () => {
    const t = prOf(workId);
    if (!t) return;
    await services.github.requestAiReview(t.repo, t.number);
    await refreshWork(workId, ['pr']);
  });
}

export async function markPrReady(workId: string) {
  const t = prOf(workId);
  if (!t) return;
  await services.github.markReady(t.repo, t.number);
  await refreshWork(workId, ['pr']);
}

export function mergePr(workId: string) {
  return busy(workId, 'merge', async () => {
    const t = prOf(workId);
    if (!t) return;
    await services.github.merge(t.repo, t.number);
    if (t.work.ticket) await services.jira.transition(t.work.ticket.key, 'Done');
    await refreshWork(workId, ['pr', 'ticket']);
  });
}

/**
 * Adds a comment. Pass `threadId` to reply to an existing thread, or an anchor
 * (`filePath`/`line`/`side`) to start a new one. Comments on a PR I am
 * reviewing stay `pending` until `submitReview` is called.
 */
export async function addReviewComment(
  workId: string,
  target: { threadId: string } | { filePath: string; line: number; side: 'old' | 'new' },
  body: string,
) {
  const t = prOf(workId);
  if (!t) return;
  const comment =
    'threadId' in target
      ? { threadId: target.threadId, body }
      : { path: target.filePath, line: target.line, side: target.side === 'old' ? ('LEFT' as const) : ('RIGHT' as const), body };
  await services.github.addReviewComment(t.repo, t.number, comment, !!t.pr.reviewRequested);
  await refreshWork(workId, ['pr']);
}

export async function deleteReviewComment(workId: string, _threadId: string, commentId: string) {
  const t = prOf(workId);
  if (!t) return;
  await services.github.deleteReviewComment(t.repo, t.number, commentId);
  await refreshWork(workId, ['pr']);
}

export async function resolveThread(workId: string, threadId: string, resolved: boolean) {
  const t = prOf(workId);
  if (!t) return;
  await services.github.setThreadResolved(t.repo, t.number, threadId, resolved);
  await refreshWork(workId, ['pr']);
}

/** Publishes all pending comments together with a verdict. */
export function submitReview(workId: string, verdict: 'approve' | 'request-changes' | 'comment') {
  return busy(workId, 'review', async () => {
    const t = prOf(workId);
    if (!t) return;
    const event = verdict === 'approve' ? 'APPROVE' : verdict === 'request-changes' ? 'REQUEST_CHANGES' : 'COMMENT';
    await services.github.submitReview(t.repo, t.number, event);
    await refreshWork(workId, ['pr']);
  });
}

// ---- CI --------------------------------------------------------------------

/** Triggers a new build; state/sync.ts polls it until it is finished. */
export async function runPipeline(workId: string) {
  const w = findWork(workId);
  const branch = w?.worktree?.branch ?? w?.pr?.sourceBranch;
  if (!w || !branch) return;
  await services.ci.trigger(w.repo, { branch, prNumber: w.pr?.number });
  await refreshWork(workId, ['ci']);
}

// ---- local app -------------------------------------------------------------

export function launchApp(workId: string, navigate = true) {
  const w = findWork(workId);
  if (!w) return Promise.resolve();
  if (navigate) selectWork(workId, 'preview');
  return busy(workId, 'app', async () => {
    await services.devServer.start(workId, { repo: w.repo, cwd: w.worktree?.path, title: w.title });
    await refreshWork(workId, ['app']); // shows "starting"; sync.ts polls until it is up
  });
}

export async function stopApp(workId: string) {
  await services.devServer.stop(workId);
  await refreshWork(workId, ['app']);
}
