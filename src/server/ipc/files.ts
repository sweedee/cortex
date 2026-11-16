import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../lib/atomicWrite';
import { listDir } from '../lib/files';
import { log } from '../lib/log';
import type { Roots } from '../lib/pathPolicy';
import { isConfigFile } from '../lib/userConfig';
import { Watchers } from '../lib/watchers';
import { WorkspaceFile } from '../lib/workspaceFile';
import { handle, type IpcContext } from './handle';

/** `workspace:*` and `fs:*`. */
export function registerFiles(ctx: IpcContext, roots: Roots, userData: string) {
  const workspace = new WorkspaceFile(join(userData, 'workspace.json'));
  handle(ctx, 'workspace:load', () => workspace.load());
  handle(ctx, 'workspace:save', ({ data }) => workspace.save(data));
  handle(ctx, 'workspace:path', () => workspace.file);

  // only inside the registered roots (lib/pathPolicy.ts)
  handle(ctx, 'fs:setRoots', ({ roots: list }) => {
    const refused = roots.set(list);
    if (refused.length) log.warn(`[fs] refused roots: ${refused.map((r) => `${r.path} (${r.reason})`).join(', ')}`);
    return refused;
  });
  handle(ctx, 'fs:readText', ({ path }) => (roots.check(path), fs.readFile(path, 'utf8')));
  handle(ctx, 'fs:writeText', ({ path, text }) => {
    roots.check(path);
    // config.json holds the editor command and the claude binary: only the server writes it (`config:update`)
    if (isConfigFile(path, userData)) throw new Error('fs:writeText: config.json is changed through config:update only');
    return atomicWrite(path, text);
  });
  handle(ctx, 'fs:list', ({ dir, options }) => (roots.check(dir), listDir(dir, options)));

  // each watch belongs to the browser tab that made it (its client id); index.ts closes a tab's
  // watches when its event socket is gone for good (a reload starts a tab that knows none of the old ids)
  const watchers = new Watchers((e) => ctx.send('fs:changed', e));
  handle(ctx, 'fs:watch', ({ dir }, caller) => (roots.check(dir), watchers.watch(dir, caller.clientId)));
  handle(ctx, 'fs:unwatch', ({ watchId }) => watchers.unwatch(watchId));
  return {
    closeWatchers: (clientId?: string) => (clientId === undefined ? watchers.closeAll() : watchers.closeOwner(clientId)),
    /** don't exit in the middle of a workspace write */
    flush: async () => {
      watchers.closeAll();
      if (workspace.busy) await workspace.flush().catch((err: unknown) => log.error('[workspace] flush on shutdown failed', err));
    },
  };
}
