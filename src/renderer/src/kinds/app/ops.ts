/**
 * Start / stop / restart an app item through the app runner in main (`appOps`). The runner id is the
 * item id (stored as `data.procId`); state changes come back as `app:state` (sync/live.ts).
 * Demo items (no real path) can only be stopped locally.
 */
import { appOps } from '../../data/apps';
import { isRealPath, type ItemOf } from '../../domain';
import { getState, patchData } from '../../store';
import { errorText, runTask } from '../../ui/task';
import { toast } from '../common';

type App = ItemOf<'app'>;

export const NO_DIR_HINT = "Set the project's base checkout in Settings (or launch it from a worktree) to run it here.";

export const isLive = (a: App) => a.data.state === 'running' || a.data.state === 'starting';
export const runnerId = (a: App) => a.data.procId ?? a.id;

/** Why it can't be started, or undefined. */
export function cannotStart(a: App): string | undefined {
  if (!a.data.command.trim()) return 'No start command';
  if (!isRealPath(a.data.cwd)) return NO_DIR_HINT;
  return undefined;
}

/** The request `apps:start` gets (the item id is the runner id). */
export const startRequest = (a: App) => ({ id: a.id, cwd: a.data.cwd, command: a.data.command });

/** The item as it is now in the store (actions may hold an older copy). */
const fresh = (a: App): App => {
  const cur = getState().items.find((i) => i.id === a.id);
  return cur?.kind === 'app' ? cur : a;
};

async function launch(item: App, label: string, work: () => Promise<unknown>) {
  const a = fresh(item);
  const why = cannotStart(a);
  if (why) return toast(`Can't start ${a.title}`, why, 'warning');
  const before = { state: a.data.state, url: a.data.url, port: a.data.port };
  patchData<'app'>(a, { state: 'starting', procId: a.id, url: undefined, port: undefined }, { notice: undefined });
  // spawning returns right away (progress shows on the ring and in the sidebar), so no progress toast
  try {
    await work();
  } catch (e) {
    toast(`${label} ${a.title} failed`, errorText(e), 'critical');
    // failed before main took it over (e.g. a bad cwd): back to what it was
    if (fresh(a).data.state === 'starting') patchData<'app'>(fresh(a), before);
  }
}

export const startApp = (a: App) => launch(a, 'Starting', () => appOps.start(startRequest(fresh(a))));

/** Restart in main; if main doesn't know the app any more (Cortex restarted) start it fresh. */
export function restartApp(a: App) {
  if (!isLive(fresh(a)) || !a.data.procId) return startApp(a);
  return launch(a, 'Restarting', async () => {
    try {
      return await appOps.restart(runnerId(a));
    } catch (e) {
      if (/unknown app/i.test(errorText(e))) return appOps.start(startRequest(fresh(a)));
      throw e;
    }
  });
}

export async function stopApp(item: App) {
  const a = fresh(item);
  if (!a.data.procId || !isRealPath(a.data.cwd)) {
    patchData<'app'>(a, { state: 'stopped' });
    toast('App stopped', a.title, 'info');
    return;
  }
  const stopped = await runTask(`Stopping ${a.title}`, appOps.stop(runnerId(a)), { success: 'App stopped' });
  // main did not run it (Cortex restarted meanwhile): it is not running
  if (stopped === false && isLive(fresh(a))) patchData<'app'>(fresh(a), { state: 'stopped' });
}
