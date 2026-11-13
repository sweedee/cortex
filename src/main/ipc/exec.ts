import { app } from 'electron';
import type { ExecRequest } from '../../shared/ipc';
import { OutputBatcher } from '../lib/batcher';
import { runExec, type ExecSpawn } from '../lib/exec';
import { ProcManager } from '../lib/procManager';
import { handle, type IpcContext } from './handle';

/** `exec:*` (one-shot, allowlisted, no shell) and `proc:*` (long-running, streamed). */
export function registerExec(ctx: IpcContext, opts: { resolve?: (req: ExecRequest) => ExecSpawn } = {}) {
  // allowlisted names may map to something else (jira-mock → node <script>)
  handle(ctx, 'exec:run', (req) => runExec(opts.resolve ? opts.resolve(req) : req));

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
  handle(ctx, 'proc:start', (req) => procs.start(req));
  handle(ctx, 'proc:stop', ({ id }) => procs.stop(id));
  handle(ctx, 'proc:list', () => procs.list());

  // no orphaned dev servers: kill every child tree when the app goes away
  app.on('will-quit', () => procs.stopAll());
  process.on('exit', () => procs.stopAll());
}
