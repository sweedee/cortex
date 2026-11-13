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

export function killTree(pid: number | undefined, opts: { sync?: boolean } = {}): void {
  if (!pid) return;
  if (isWin) {
    const args = ['/pid', String(pid), '/T', '/F'];
    if (opts.sync) spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
