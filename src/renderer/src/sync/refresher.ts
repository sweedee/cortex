/**
 * Background refresher: keeps the ring caches on the items current while the window is
 * visible. Every `settings.refreshSec` (default 60 s; 15 s for PRs with running checks):
 *
 * - worktree → `git status` (dirty, changed files) + ahead / behind its base branch
 * - open PR → `gh pr view` (state, review decision, mergeable, checks rollup)
 * - ticket → `jira view` (status, category, assignee, sprint, points, title)
 * - project with a repo → open PR count, Renovate PR count
 * - build that is not completed → `gh run view` (GitHub Actions run id) or, for other CI linked
 *   to a PR, that PR's `gh pr checks` (one call per PR for all its builds); 15 s while running
 *
 * Results also seed the matching query caches. Failures are quiet: logged once per item, and
 * the item (and, for gh, its whole repo) backs off exponentially (up to 30 intervals). Paths
 * that are not absolute (demo data like `~/wt/…`) are skipped without calling git.
 */
import { ipcErrorMessage } from '../../../shared/ipcError';
import { queryClient } from '../data/queryClient';
import { qk } from '../data/queryKeys';
import { isRealPath, type Item, type ItemOf } from '../domain';
import { isDesktop, native } from '../native';
import { diffPatch, runPatch } from '../kinds/build/logic';
import { planBuildSync } from '../kinds/pr/builds';
import { getState, itemById, patchData, setSynced, setSyncError } from '../store';
import { showToast } from '@dynatrace/strato-components/notifications';
import { changes, prChecksRunning, prPatch, projectStatsPatch, ticketPatch, worktreeGitPatch } from './mapping';

const TICK_MS = 5_000;
const FAST_MS = 15_000;
const PARALLEL = 3;

const isRealRepo = (r: string | undefined) => !!r && /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith('unknown/');

interface Job {
  /** item id */
  id: string;
  /** shared back-off key (a gh repo), besides the item itself */
  group?: string;
  fast: boolean;
  run: () => Promise<void>;
}

interface Track {
  last: number;
  fails: number;
  logged?: boolean;
}
const track = new Map<string, Track>();

/** The refresh jobs for the current items (exported for tests). */
export function jobsFor(items: Item[]): Job[] {
  const jobs: Job[] = [];
  for (const i of items) {
    if (i.archived) continue;
    switch (i.kind) {
      case 'worktree':
        if (isRealPath(i.data.path)) jobs.push({ id: i.id, fast: false, run: () => refreshWorktree(i.id) });
        break;
      case 'pr':
        if (i.data.state === 'open' && isRealRepo(i.data.repo)) jobs.push({ id: i.id, group: `gh:${i.data.repo}`, fast: prChecksRunning(i.data), run: () => refreshPr(i.id) });
        break;
      case 'ticket':
        if (i.data.key) jobs.push({ id: i.id, group: 'jira', fast: false, run: () => refreshTicket(i.id) });
        break;
      case 'project':
        if (isRealRepo(i.data.repo)) jobs.push({ id: i.id, group: `gh:${i.data.repo}`, fast: false, run: () => refreshProject(i.id) });
        break;
      case 'build': {
        if (i.data.state === 'completed' || !isRealRepo(i.data.repo)) break;
        if (i.data.runId && /^\d+$/.test(i.data.runId)) jobs.push({ id: i.id, group: `gh:${i.data.repo}`, fast: true, run: () => refreshBuildRun(i.id) });
        else if (i.data.prNumber) {
          // other CI (Jenkins…) only shows up in the PR's checks: one job per PR covers all its builds
          const key = `checks:${i.data.repo}#${i.data.prNumber}`;
          if (!jobs.some((j) => j.id === key)) jobs.push({ id: key, group: `gh:${i.data.repo}`, fast: true, run: () => refreshPrChecks(i.data.repo, i.data.prNumber!, i.data.branch) });
        }
        break;
      }
    }
  }
  return jobs;
}

const get = <K extends Item['kind']>(id: string, kind: K) => {
  const it = itemById(id);
  return it?.kind === kind ? (it as ItemOf<K>) : undefined;
};

async function refreshWorktree(id: string) {
  const w = get(id, 'worktree');
  if (!w) return;
  const dir = w.data.path;
  const status = await native.git.status(dir);
  queryClient.setQueryData(qk.git.status(dir), status);
  const count = async (range: string) => (await native.git.log(dir, { range, limit: 500 })).length;
  let vsBase: { ahead: number; behind: number } | null = null;
  for (const base of [`origin/${w.data.baseBranch}`, w.data.baseBranch]) {
    try {
      vsBase = { ahead: await count(`${base}..HEAD`), behind: await count(`HEAD..${base}`) };
      break;
    } catch {
      /* no such ref: try the local branch, then fall back to the upstream numbers */
    }
  }
  const cur = get(id, 'worktree');
  if (!cur) return;
  const patch = worktreeGitPatch(status, vsBase);
  if (changes(cur.data, patch)) patchData<'worktree'>(cur, patch);
}

async function refreshPr(id: string) {
  const p = get(id, 'pr');
  if (!p) return;
  const pr = await native.gh.prView(p.data.repo, p.data.number);
  queryClient.setQueryData(qk.gh.pr(p.data.repo, p.data.number), pr);
  const cur = get(id, 'pr');
  if (!cur) return;
  const patch = prPatch(pr);
  if (changes(cur.data, patch)) patchData<'pr'>(cur, patch);
}

async function refreshTicket(id: string) {
  const t = get(id, 'ticket');
  if (!t) return;
  const issue = await native.jira.view(t.data.key);
  queryClient.setQueryData(qk.jira.issue(t.data.key), issue);
  const cur = get(id, 'ticket');
  if (!cur) return;
  const { patch, title } = ticketPatch(issue);
  if (changes(cur.data, patch) || (title && title !== cur.title)) patchData<'ticket'>(cur, patch, title ? { title } : {});
}

async function refreshProject(id: string) {
  const p = get(id, 'project');
  if (!p) return;
  const repo = p.data.repo;
  const [open, renovate] = await Promise.all([native.gh.prList(repo, { state: 'open', limit: 200 }), native.gh.renovatePrs(repo)]);
  queryClient.setQueryData(qk.gh.prList(repo, { state: 'open', limit: 200 }), open);
  queryClient.setQueryData(qk.gh.renovate(repo), renovate);
  const cur = get(id, 'project');
  if (!cur) return;
  const patch = projectStatsPatch(cur.data, open.length, renovate.length);
  if (changes(cur.data, patch)) patchData<'project'>(cur, patch);
}

async function refreshBuildRun(id: string) {
  const b = get(id, 'build');
  if (!b) return;
  const runId = Number(b.data.runId);
  const run = await native.gh.runView(b.data.repo, runId);
  queryClient.setQueryData(qk.gh.run(b.data.repo, runId), run);
  const cur = get(id, 'build');
  if (!cur) return;
  const patch = diffPatch(cur.data, runPatch(run));
  if (Object.keys(patch).length) patchData<'build'>(cur, patch);
}

/** The PR's checks → its existing build items (never creates any; that is the PR sidebar's "Add to canvas"). */
async function refreshPrChecks(repo: string, number: number, branch: string) {
  const checks = await native.gh.prChecks(repo, number);
  queryClient.setQueryData(qk.gh.checks(repo, number), checks);
  const items = getState().items;
  const pr =
    items.find((i): i is ItemOf<'pr'> => i.kind === 'pr' && i.data.repo === repo && i.data.number === number) ??
    ({ id: '', kind: 'pr', data: { repo, number, headBranch: branch } } as unknown as ItemOf<'pr'>);
  for (const u of planBuildSync(items, pr, checks).updates) patchData<'build'>(u.id, u.patch);
}

/** Next time a job may run, given its own and its group's failures. */
function dueAt(job: Job, intervalMs: number): number {
  const own = track.get(job.id);
  const grp = job.group ? track.get(job.group) : undefined;
  const fails = Math.max(own?.fails ?? 0, grp?.fails ?? 0);
  const base = job.fast ? Math.min(FAST_MS, intervalMs) : intervalMs;
  return (own?.last ?? 0) + base * Math.min(2 ** fails, 30);
}

/** Keys (repo or item) that already got a "sync failing" toast; cleared on the next success. */
const toasted = new Set<string>();
const errorLine = (e: unknown) => ipcErrorMessage(e).split('\n')[0];

async function runJob(job: Job) {
  const t = track.get(job.id) ?? { last: 0, fails: 0 };
  t.last = Date.now();
  track.set(job.id, t);
  try {
    await job.run();
    t.fails = 0;
    if (job.group) track.delete(job.group);
    toasted.delete(job.group ?? job.id);
    setSynced(job.id);
  } catch (e) {
    t.fails++;
    if (job.group) {
      const g = track.get(job.group) ?? { last: 0, fails: 0 };
      g.fails = Math.max(g.fails, t.fails);
      track.set(job.group, g);
    }
    const message = errorLine(e);
    setSyncError(job.id, message);
    const key = job.group ?? job.id;
    if (!toasted.has(key)) {
      toasted.add(key);
      const what = job.group?.startsWith('gh:') ? job.group.slice(3) : (itemById(job.id)?.handle ?? job.id);
      showToast({ type: 'warning', title: `Sync failing for ${what}`, message: `${message} Retrying in the background.`, lifespan: 6000 });
    }
    if (!t.logged) {
      t.logged = true;
      console.info(`[refresh] ${itemById(job.id)?.handle ?? job.id}: ${errorLine(e)} (backing off)`);
    }
  }
}

let running: Promise<void> | null = null;
/**
 * One pass: run the due jobs (a few at a time); `force` runs every job. A background pass in
 * flight is awaited first (a forced pass then still runs). Exported for the smoke probe / tests.
 */
export async function refreshDue(force = false): Promise<void> {
  if (running) {
    await running;
    if (!force) return;
  }
  const pass = (async () => {
    const intervalMs = getState().settings.refreshSec * 1000;
    const now = Date.now();
    const due = jobsFor(getState().items).filter((j) => force || dueAt(j, intervalMs) <= now);
    for (let i = 0; i < due.length; i += PARALLEL) await Promise.all(due.slice(i, i + PARALLEL).map(runJob));
  })();
  running = pass.finally(() => {
    if (running === guarded) running = null;
  });
  const guarded = running;
  await guarded;
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Start the background refresher (desktop only; pauses while the window is hidden). */
export function startRefresher(): () => void {
  if (!isDesktop || timer) return () => {};
  const tick = () => {
    if (document.visibilityState === 'visible') void refreshDue();
  };
  timer = setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', tick);
  setTimeout(tick, 1500);
  return () => {
    clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', tick);
  };
}
