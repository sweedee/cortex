/**
 * Background refresher: keeps the ring caches on the items current while the window is
 * visible. Every `settings.refreshSec` (default 60 s; 15 s for jobs marked `fast`) it runs the
 * jobs the kinds ask for (`KindModule.sync`, e.g. worktree → `git status`, open PR → `gh pr view`,
 * ticket → `jira view`, project → PR counts, running build → `gh run view` / the PR's checks).
 *
 * Results also seed the matching query caches. Failures are quiet: logged once per item, and
 * the item (and its job group, e.g. its whole gh repo) backs off exponentially (up to 30 intervals).
 */
import { ipcErrorMessage } from '../../../shared/ipcError';
import type { Item } from '../domain';
import { getKind } from '../kinds/registry';
import type { KindModule, SyncJob } from '../kinds/types';
import { userConfig } from '../data/config';
import { isDesktop } from '../native';
import { getState, itemById, setSynced, setSyncError } from '../store';
import { showToast } from '@dynatrace/strato-components/notifications';

const TICK_MS = 5_000;

type Job = SyncJob;

interface Track {
  last: number;
  fails: number;
  logged?: boolean;
}
const track = new Map<string, Track>();

/** The refresh jobs for the current items (exported for tests). Jobs shared by several items (same id) run once. */
export function jobsFor(items: Item[]): Job[] {
  const jobs: Job[] = [];
  const ids = new Set<string>();
  for (const i of items) {
    if (i.archived) continue;
    for (const j of (getKind(i.kind) as unknown as KindModule).sync?.(i) ?? []) {
      if (ids.has(j.id)) continue;
      ids.add(j.id);
      jobs.push(j);
    }
  }
  return jobs;
}

/** Next time a job may run, given its own and its group's failures. */
function dueAt(job: Job, intervalMs: number): number {
  const own = track.get(job.id);
  const grp = job.group ? track.get(job.group) : undefined;
  const fails = Math.max(own?.fails ?? 0, grp?.fails ?? 0);
  const base = job.fast ? Math.min(userConfig().refresh.fastSec * 1000, intervalMs) : intervalMs;
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
    const parallel = userConfig().refresh.parallel;
    for (let i = 0; i < due.length; i += parallel) await Promise.all(due.slice(i, i + parallel).map(runJob));
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
