/**
 * Kill a process and everything it started. Windows has no process groups that Node can
 * signal, so we use `taskkill /T /F` (ships with Windows); on POSIX the children are
 * spawned `detached` (own process group) and we signal the whole group (-pid). This
 * avoids the unmaintained `tree-kill` package and gives us a synchronous variant for
 * app quit, when there is no time left for async work.
 */
import { spawn, spawnSync } from 'node:child_process';

export const isWin = process.platform === 'win32';

/** spawn options that make `killTree` work for the child (POSIX: own process group) */
export const treeSpawnOptions = { detached: !isWin, windowsHide: true } as const;

/** POSIX: how long a SIGTERMed tree gets before it is SIGKILLed */
export const KILL_GRACE_MS = 3000;

/** is `pid` (or, for a negative pid, the group) still alive? */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Fire-and-forget: send `sig` to the group, else the process. Returns the target that took it, or null. */
function signal(pid: number, sig: NodeJS.Signals): number | null {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, sig);
      return target;
    } catch {
      /* try the next / already gone */
    }
  }
  return null;
}

/**
 * Terminate the tree. On POSIX it is SIGTERM first; if anything in it is still alive after
 * `KILL_GRACE_MS` (a process that ignores or traps SIGTERM), SIGKILL follows. The follow-up timer is
 * unref'd so it never keeps the app alive; `sync` (app quit) cannot wait, so it goes straight to SIGKILL.
 */
export function killTree(pid: number | undefined, opts: { sync?: boolean; graceMs?: number } = {}): void {
  if (!pid) return;
  if (isWin) {
    const args = ['/pid', String(pid), '/T', '/F'];
    if (opts.sync) spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return;
  }
  if (opts.sync) {
    signal(pid, 'SIGKILL');
    return;
  }
  const target = signal(pid, 'SIGTERM');
  if (target === null) return;
  setTimeout(() => {
    if (alive(target)) signal(pid, 'SIGKILL');
  }, opts.graceMs ?? KILL_GRACE_MS).unref();
}
