/**
 * Keeps the store in sync with the services: initial load, re-fetching parts of a
 * work item after something changed, polling things that are in flight, and feeding
 * live Claude events into their sessions.
 *
 * Data flow is always: service (tool-shaped DTO) → mapper → store. Actions never put
 * tool data into the store themselves; they call a service and then `refreshWork`.
 */
import type { AgentSession, AppInstance, Pipeline, PullRequest, Ticket, WorkItem, Worktree } from '../model/types';
import { config } from '../services/config';
import { services } from '../services';
import { applyClaudeEvent, mapSkill, planFromEvents, replayTranscript } from '../services/mappers/claude';
import { mapBuild } from '../services/mappers/ci';
import { displayName, mapPullRequest } from '../services/mappers/github';
import { mapJiraIssue } from '../services/mappers/jira';
import type { ClaudeEvent, SessionRef, WorkRef, Workspace } from '../services/types';
import { getState, patchSession, patchWork, setState } from './store';

// ---- workspace (Cortex's own persisted state) --------------------------------

let workspace: Workspace = { work: [], sessions: [] };

export const workRef = (workId: string) => workspace.work.find((w) => w.id === workId);

export function updateWorkspace(update: (w: Workspace) => Workspace) {
  workspace = update(workspace);
  void services.workspace.save(workspace);
}

// ---- fetching one work item ----------------------------------------------------

export type WorkPart = 'ticket' | 'git' | 'pr' | 'ci' | 'app';
const ALL_PARTS: WorkPart[] = ['ticket', 'git', 'pr', 'ci', 'app'];

async function fetchTicket(ref: WorkRef): Promise<Ticket | undefined> {
  return ref.ticketKey ? mapJiraIssue(await services.jira.getIssue(ref.ticketKey)) : undefined;
}

async function fetchWorktree(ref: WorkRef): Promise<Worktree | undefined> {
  if (!ref.worktreePath) return undefined;
  const found = (await services.git.listWorktrees(ref.repo)).find((w) => w.path === ref.worktreePath);
  if (!found) return undefined;
  const status = await services.git.status(found.path, config.baseBranch);
  return { repo: ref.repo, path: found.path, branch: found.branch, baseBranch: config.baseBranch, ...status };
}

async function fetchPr(ref: WorkRef, branch: string | undefined): Promise<PullRequest | undefined> {
  const { github } = services;
  const number = ref.prNumber ?? (branch ? await github.findPullRequest(ref.repo, branch) : undefined);
  if (number === undefined) return undefined;
  const [pr, diff, threads] = await Promise.all([
    github.getPullRequest(ref.repo, number),
    github.getDiff(ref.repo, number),
    github.getReviewThreads(ref.repo, number),
  ]);
  return mapPullRequest(pr, diff, threads, getState().me);
}

async function fetchPipeline(ref: WorkRef, branch: string | undefined, prNumber: number | undefined): Promise<Pipeline | undefined> {
  if (!branch) return undefined;
  const build = await services.ci.getBuild(ref.repo, { branch, prNumber });
  return build && mapBuild(build);
}

const fetchApp = (ref: WorkRef): Promise<AppInstance> => services.devServer.get(ref.id);

async function fetchWork(ref: WorkRef): Promise<WorkItem> {
  const [ticket, worktree, app] = await Promise.all([fetchTicket(ref), fetchWorktree(ref), fetchApp(ref)]);
  const pr = await fetchPr(ref, worktree?.branch);
  const pipeline = await fetchPipeline(ref, worktree?.branch ?? pr?.sourceBranch, pr?.number);
  return { id: ref.id, kind: ref.kind, title: ref.title, repo: ref.repo, ticket, worktree, pr, pipeline, app, updatedAt: ref.createdAt };
}

/**
 * Re-fetches the given parts of a work item (default: everything) and puts them in the store.
 * Call it after every action that changed something in a tool.
 */
export async function refreshWork(workId: string, parts: WorkPart[] = ALL_PARTS): Promise<void> {
  const ref = workRef(workId);
  if (!ref) return;
  const want = (p: WorkPart) => parts.includes(p);
  const current = () => getState().work.find((w) => w.id === workId);

  const [ticket, worktree, app] = await Promise.all([
    want('ticket') ? fetchTicket(ref) : current()?.ticket,
    want('git') ? fetchWorktree(ref) : current()?.worktree,
    want('app') ? fetchApp(ref) : current()?.app,
  ]);
  const pr = want('pr') ? await fetchPr(ref, worktree?.branch) : current()?.pr;
  const pipeline = want('ci') ? await fetchPipeline(ref, worktree?.branch ?? pr?.sourceBranch, pr?.number) : current()?.pipeline;

  patchWork(workId, () => ({ ticket, worktree, pr, pipeline, app: app ?? { status: 'stopped', logs: [] } }));
  watch(workId);
}

// ---- polling -------------------------------------------------------------------

const polling = new Set<string>();

/** While a build is running or an app is starting, keep re-fetching that part until it settles. */
function watch(workId: string) {
  const work = getState().work.find((w) => w.id === workId);
  if (!work) return;
  const building = work.pipeline?.status === 'running' || work.pipeline?.status === 'queued';
  const schedule = (part: WorkPart, ms: number) => {
    const key = `${workId}:${part}`;
    if (polling.has(key)) return;
    polling.add(key);
    setTimeout(() => {
      polling.delete(key);
      void refreshWork(workId, [part]);
    }, ms);
  };
  if (building) schedule('ci', config.poll.ciMs);
  if (work.app.status === 'starting') schedule('app', config.poll.devServerMs);
}

// ---- Claude sessions -----------------------------------------------------------

/** Sessions that already have a Claude process/transcript — the next message must `--resume` them. */
export const startedSessions = new Set<string>();

export const blankSession = (ref: SessionRef): AgentSession => ({
  ...ref,
  status: ref.kind === 'chat' ? 'waiting' : 'done',
  model: 'claude',
  messages: [],
});

async function fetchSession(ref: SessionRef): Promise<{ session: AgentSession; plan?: string }> {
  const { events, running } = await services.claude.getTranscript(ref.id);
  if (events.length > 0) startedSessions.add(ref.id);
  return {
    session: replayTranscript(blankSession(ref), events, running),
    plan: ref.kind === 'plan' && !running ? planFromEvents(events) : undefined,
  };
}

function onClaudeEvent(event: ClaudeEvent) {
  const session = getState().sessions.find((s) => s.id === event.session_id);
  if (!session) return;
  patchSession(session.id, (s) => applyClaudeEvent(s, event));

  if (event.type === 'result' && session.workId) {
    // a plan agent's final answer is the plan
    if (session.kind === 'plan' && !event.is_error && event.subtype === 'success' && event.result) {
      const planMd = event.result;
      patchWork(session.workId, () => ({ planMd }));
    }
    // the agent may have committed, pushed, opened a PR or kicked off CI
    void refreshWork(session.workId, ['git', 'pr', 'ci']);
  }
}

// ---- boot ----------------------------------------------------------------------

/** Loads everything once at startup. Resolves when the store is ready to render. */
export async function boot(): Promise<void> {
  const [user, ws] = await Promise.all([services.github.whoami(), services.workspace.load()]);
  workspace = ws;
  setState((s) => ({ ...s, me: displayName(user) }));
  // skills for the composer autocomplete: not needed to render anything, so don't wait for them
  void services.claude
    .listSkills()
    .then((list) => list.map(mapSkill))
    .catch(() => [])
    .then((skills) => setState((s) => ({ ...s, skills })));

  const [work, sessions, issues] = await Promise.all([
    Promise.all(ws.work.map(fetchWork)),
    Promise.all(ws.sessions.map(fetchSession)),
    services.jira.myOpenIssues(),
  ]);

  // attach the latest plan of each work item
  for (const { session, plan } of [...sessions].sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt))) {
    const target = work.find((w) => w.id === session.workId);
    if (target && plan) target.planMd = plan;
  }

  const onBoard = new Set(ws.work.map((w) => w.ticketKey));
  setState((s) => ({
    ...s,
    work,
    sessions: sessions.map((x) => x.session),
    backlog: issues.filter((i) => !onBoard.has(i.key)).map(mapJiraIssue),
    ready: true,
  }));

  services.claude.subscribe(onClaudeEvent);
  work.forEach((w) => watch(w.id));
}
