/**
 * Keeps the store in sync with the services: initial load, re-fetching parts of a
 * work item after something changed, polling things that are in flight, and feeding
 * live Claude events into their sessions.
 *
 * Data flow is always: service (tool-shaped DTO) → mapper → store. Actions never put
 * tool data into the store themselves; they call a service and then `refreshWork`.
 */
import type { AgentSession, AppInstance, Pipeline, PullRequest, RenovatePr, Ticket, WorkItem, Worktree } from '../model/types';
import { CLAUDE_DEFAULTS, config } from '../services/config';
import { services } from '../services';
import { applyClaudeEvent, mapSkill, planFromEvents, replayTranscript } from '../services/mappers/claude';
import { mapBuild } from '../services/mappers/ci';
import { displayName, mapPullRequest, mapRenovatePr } from '../services/mappers/github';
import { mapJiraIssue } from '../services/mappers/jira';
import type { ClaudeEvent, SessionRef, WorkRef, Workspace } from '../services/types';
import { diffSession, diffWork, renovateFinished } from './notify';
import { pushNotices } from './notifications';
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

/** The project's default branch. */
export const projectBase = (repo: string) => getState().projects.find((p) => p.id === repo)?.baseBranch ?? config.baseBranch;

async function fetchWorktree(ref: WorkRef): Promise<Worktree | undefined> {
  if (!ref.worktreePath) return undefined;
  const found = (await services.git.listWorktrees(ref.repo)).find((w) => w.path === ref.worktreePath);
  if (!found) return undefined;
  // stacked work is based on its parent's branch, everything else on the default branch
  const baseBranch = ref.baseBranch ?? projectBase(ref.repo);
  const status = await services.git.status(found.path, baseBranch);
  return { repo: ref.repo, path: found.path, branch: found.branch, baseBranch, ...status };
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

  // read the state to compare with only now: other refreshes may have run while we were fetching
  const before = current();
  const next = { ticket, worktree, pr, pipeline, app: app ?? { status: 'stopped' as const, logs: [] } };
  // unchanged parts keep their identity (and nothing is written if nothing changed), so the background
  // refresh does not re-render views or reset their local state every few seconds
  const changed = !before || (Object.keys(next) as (keyof typeof next)[]).some((k) => !same(before[k], next[k]));
  if (changed) {
    patchWork(workId, (w) => Object.fromEntries((Object.keys(next) as (keyof typeof next)[]).map((k) => [k, same(w[k], next[k]) ? w[k] : next[k]])));
    const after = current();
    if (before && after) pushNotices(diffWork(before, after, getState().me));
  }
  watch(workId);
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

// ---- polling -------------------------------------------------------------------

const polling = new Set<string>();
/** When each work item's wait for the AI reviewer began (bounds the PR poll). */
const aiWaitSince = new Map<string, number>();

/** While a build is running, an app is starting or the AI reviewer has not answered, keep re-fetching that part until it settles. */
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

  // the AI bot answers a trigger comment on its own time; give up after a while (the next action refreshes anyway)
  if (work.pr?.reviewers.some((r) => r.isBot && r.state === 'pending')) {
    const since = aiWaitSince.get(workId) ?? Date.now();
    aiWaitSince.set(workId, since);
    if (Date.now() - since < config.poll.aiReviewTimeoutMs) schedule('pr', config.poll.prMs);
  } else aiWaitSince.delete(workId);
}

// ---- Claude sessions -----------------------------------------------------------

/** Sessions that already have a Claude process/transcript — the next message must `--resume` them. */
export const startedSessions = new Set<string>();

const CHOICE_KEY = 'cortex.claude.choice.v1';

/** Model + effort of the last pick in a composer: the default for new sessions. */
export function claudeChoice(): { model: string; effort: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as { model?: string; effort?: string } | null;
    return { model: saved?.model ?? CLAUDE_DEFAULTS.model, effort: saved?.effort ?? CLAUDE_DEFAULTS.effort };
  } catch {
    return CLAUDE_DEFAULTS; // storage unavailable or corrupt
  }
}

export function saveClaudeChoice(choice: { model: string; effort: string }) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // not persisted, the pick still applies to this session
  }
}

export const blankSession = (ref: SessionRef): AgentSession => ({
  ...ref,
  status: ref.kind === 'chat' ? 'waiting' : 'done',
  ...claudeChoice(), // replaced by the model the first `system` event reports
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

/** The Renovate PRs that were open when a project session's turn began (what the review is measured against). */
const renovateBefore = new Map<string, RenovatePr[]>();

/** Name of whatever a session belongs to, for notifications. */
function subjectOfSession(s: AgentSession): string {
  const { work, projects } = getState();
  if (s.workId) {
    const w = work.find((x) => x.id === s.workId);
    return w?.ticket?.key ?? w?.title ?? s.workId;
  }
  if (s.projectId) return projects.find((p) => p.id === s.projectId)?.name ?? s.projectId;
  return 'Ask Cortex';
}

function onClaudeEvent(event: ClaudeEvent) {
  const session = getState().sessions.find((s) => s.id === event.session_id);
  if (!session) return;
  patchSession(session.id, (s) => applyClaudeEvent(s, event));
  const after = getState().sessions.find((s) => s.id === session.id);
  if (after) pushNotices(diffSession(session, after, subjectOfSession(after)));

  if (session.projectId) {
    const projectId = session.projectId;
    if (event.type === 'system') renovateBefore.set(session.id, getState().renovate[projectId] ?? []);
    if (event.type === 'result') {
      // the agent merged some PRs: show the new list, and say what came of the run
      const before = renovateBefore.get(session.id) ?? [];
      void refreshRenovate(projectId)
        .then((list) => {
          if (event.subtype !== 'success' || event.is_error) return;
          const name = getState().projects.find((p) => p.id === projectId)?.name ?? projectId;
          pushNotices([renovateFinished(name, projectId, session.id, before, list)]);
        })
        .catch(() => undefined);
    }
  }

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

// ---- Renovate PRs of a project ------------------------------------------------------

/** Fetches the project's open Renovate PRs into the store (loaded when the project page opens, and after the agent ran). */
export async function refreshRenovate(projectId: string): Promise<RenovatePr[]> {
  const items = await services.github.listPullRequests(projectId, { author: config.renovate.author, state: 'open', limit: 100 });
  const list = items.map(mapRenovatePr).sort((a, b) => a.number - b.number);
  setState((s) => (same(s.renovate[projectId], list) ? s : { ...s, renovate: { ...s.renovate, [projectId]: list } }));
  return list;
}

// ---- background refresh -------------------------------------------------------------

let refreshingBoard = false;

/** Work that appeared in the workspace without a click here (e.g. somebody asked for my review). */
async function adoptNewWork() {
  const loaded = await services.workspace.load();
  const known = new Set(workspace.work.map((w) => w.id));
  const fresh = loaded.work.filter((w) => !known.has(w.id) && !getState().work.some((x) => x.id === w.id));
  if (fresh.length === 0) return;
  workspace = { ...workspace, work: [...fresh, ...workspace.work] }; // no save: the workspace already has them
  const items = await Promise.all(fresh.map(fetchWork));
  setState((s) => ({ ...s, work: [...items, ...s.work] }));
  for (const item of items) {
    pushNotices(diffWork(undefined, item, getState().me));
    watch(item.id);
  }
}

/** Re-fetches PR and build of every work item, so changes made elsewhere (reviews, CI) are noticed. */
export async function refreshBoard() {
  if (refreshingBoard) return;
  refreshingBoard = true;
  try {
    await adoptNewWork().catch(() => undefined);
    for (const w of getState().work) {
      const polled = [...polling].some((key) => key.startsWith(`${w.id}:`)); // a build / app / AI review is being followed anyway
      if (polled || w.pr?.state === 'merged') continue;
      await refreshWork(w.id, ['pr', 'ci']).catch(() => undefined); // one failing tool must not stop the rest
    }
  } finally {
    refreshingBoard = false;
  }
}

/** Slow timer, paused while the tab is hidden; coming back to the tab refreshes at once. */
function startBackgroundRefresh() {
  const tick = () => {
    if (!document.hidden) void refreshBoard();
  };
  window.setInterval(tick, config.poll.boardMs);
  document.addEventListener('visibilitychange', tick);
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
  startBackgroundRefresh();
}
