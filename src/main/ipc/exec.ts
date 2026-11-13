import { app } from 'electron';
import { runExec } from '../lib/exec';
import { ProcManager } from '../lib/procManager';
import { handle, type IpcContext } from './handle';

/** `exec:*` (one-shot, allowlisted, no shell) and `proc:*` (long-running, streamed). */
export function registerExec(ctx: IpcContext) {
  handle(ctx, 'exec:run', (req) => runExec(req));

  const procs = new ProcManager((channel, payload) => ctx.send(channel, payload));
  handle(ctx, 'proc:start', (req) => procs.start(req));
  handle(ctx, 'proc:stop', ({ id }) => procs.stop(id));
  handle(ctx, 'proc:list', () => procs.list());

  // no orphaned dev servers: kill every child tree when the app goes away
  app.on('will-quit', () => procs.stopAll());
  process.on('exit', () => procs.stopAll());
}
