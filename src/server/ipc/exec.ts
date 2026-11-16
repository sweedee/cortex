import type { ExecRequest } from '../../shared/ipc';
import { OutputBatcher } from '../lib/batcher';
import type { Roots } from '../lib/pathPolicy';
import { runExec, type ExecSpawn } from '../lib/exec';
import { ProcManager } from '../lib/procManager';
import { handle, type IpcContext } from './handle';

/** `exec:*` (one-shot, allowlisted, no shell) and `proc:*` (long-running, streamed). */
export function registerExec(ctx: IpcContext, opts: { roots: Roots; production: boolean; resolve?: (req: ExecRequest) => ExecSpawn }) {
  // allowlisted names may map to something else (jira-mock → the configured Jira CLI).
  // Not in production: no UI flow uses it, and git / gh / claude with
  // free-form args can run code (`git -c core.pager=…`, `gh extension install`, `claude --dangerously-…`).
  handle(ctx, 'exec:run', (req) => {
    if (opts.production) throw new Error('exec:run is only available in development');
    return runExec(opts.resolve ? opts.resolve(req) : req);
  });

  // chatty output is coalesced to one event per process and stream every 100 ms
  const batcher = new OutputBatcher((id, stream, chunk) => ctx.send('proc:output', { id, stream, chunk }), 100);
  const procs = new ProcManager((channel, payload) => {
    if (channel === 'proc:output') {
      const e = payload as { id: string; stream: 'stdout' | 'stderr'; chunk: string };
      batcher.push(e.id, e.stream, e.chunk);
    } else {
      batcher.flush((payload as { id: string }).id);
      ctx.send(channel, payload);
    }
  });
  handle(ctx, 'proc:start', (req) => {
    opts.roots.check(req.cwd, 'cwd');
    return procs.start(req);
  });
  handle(ctx, 'proc:stop', ({ id }) => procs.stop(id));
  handle(ctx, 'proc:list', () => procs.list());

  // no orphaned dev servers: the server kills every child tree when it goes away (index.ts)
  return { stopAll: () => procs.stopAll() };
}
