/**
 * Long-running child processes (dev servers, test runs, later claude sessions), keyed by a
 * caller-chosen id. Output and exit are pushed through `emit`; stop kills the whole tree.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import type { EventChannels, ProcInfo, ProcStartRequest } from '../../shared/ipc';
import { isWin, killTree, treeSpawnOptions } from './killTree';

type Emit = <C extends 'proc:output' | 'proc:exit'>(channel: C, payload: EventChannels[C]) => void;

/** Quote one argument for the platform shell (cmd.exe or sh). */
export function shellQuote(a: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(a)) return a;
  return isWin ? `"${a.replace(/"/g, '""')}"` : `'${a.replace(/'/g, `'\\''`)}'`;
}

export class ProcManager {
  private procs = new Map<string, { info: ProcInfo; child: ChildProcess }>();

  private emit: Emit;
  constructor(emit: Emit) {
    this.emit = emit;
  }

  start(req: ProcStartRequest): ProcInfo {
    if (this.procs.has(req.id)) throw new Error(`A process with id "${req.id}" is already running`);
    const opts = { cwd: req.cwd, env: { ...process.env, ...req.env }, stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[], ...treeSpawnOptions };
    // shell mode: the user's own configured command line, e.g. "npm run dev". We build the
    // line ourselves (Node's shell:true + args concatenates unquoted and is deprecated).
    const child = req.shell
      ? nodeSpawn([req.cmd, ...req.args.map(shellQuote)].join(' '), { ...opts, shell: true })
      : spawn(req.cmd, req.args, { ...opts, shell: false });
    const info: ProcInfo = { id: req.id, pid: child.pid, cmd: req.cmd, args: req.args, cwd: req.cwd, startedAt: Date.now() };
    this.procs.set(req.id, { info, child });

    const forward = (stream: 'stdout' | 'stderr') => (chunk: string) => this.emit('proc:output', { id: req.id, stream, chunk });
    child.stdout?.setEncoding('utf8').on('data', forward('stdout'));
    child.stderr?.setEncoding('utf8').on('data', forward('stderr'));

    let done = false;
    const finish = (code: number | null, signal: string | null, error?: string) => {
      if (done) return;
      done = true;
      if (this.procs.get(req.id)?.child === child) this.procs.delete(req.id);
      this.emit('proc:exit', { id: req.id, code, signal, ...(error ? { error } : {}) });
    };
    child.on('error', (err) => finish(null, null, err.message));
    child.on('close', (code, signal) => finish(code, signal));
    return info;
  }

  stop(id: string): boolean {
    const p = this.procs.get(id);
    if (!p) return false;
    killTree(p.child.pid);
    return true;
  }

  list(): ProcInfo[] {
    return [...this.procs.values()].map((p) => p.info);
  }

  /** Kill everything, synchronously (used on app quit). */
  stopAll(): void {
    for (const p of this.procs.values()) killTree(p.child.pid, { sync: true });
    this.procs.clear();
  }
}
