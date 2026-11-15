import { app } from 'electron';
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
export function registerFiles(ctx: IpcContext, roots: Roots) {
  const workspace = new WorkspaceFile(join(app.getPath('userData'), 'workspace.json'));
  handle(ctx, 'workspace:load', () => workspace.load());
  handle(ctx, 'workspace:save', ({ data }) => workspace.save(data));
  handle(ctx, 'workspace:path', () => workspace.file);

  // don't quit in the middle of a workspace write
  let flushed = false;
  app.on('before-quit', (e) => {
    if (flushed || !workspace.busy) return;
    e.preventDefault();
    void workspace.flush().catch((err) => log.error('[workspace] flush on quit failed', err)).finally(() => {
      flushed = true;
      app.quit();
    });
  });

  // only inside the registered roots (lib/pathPolicy.ts)
  handle(ctx, 'fs:setRoots', ({ roots: list }) => {
    const refused = roots.set(list);
    if (refused.length) log.warn(`[fs] refused roots: ${refused.map((r) => `${r.path} (${r.reason})`).join(', ')}`);
    return refused;
  });
  handle(ctx, 'fs:readText', ({ path }) => (roots.check(path), fs.readFile(path, 'utf8')));
  handle(ctx, 'fs:writeText', ({ path, text }) => {
    roots.check(path);
    // config.json holds the editor command and the claude binary: only main writes it (`config:update`)
    if (isConfigFile(path, app.getPath('userData'))) throw new Error('fs:writeText: config.json is changed through config:update only');
    return atomicWrite(path, text);
  });
  handle(ctx, 'fs:list', ({ dir, options }) => (roots.check(dir), listDir(dir, options)));

  const watchers = new Watchers((e) => ctx.send('fs:changed', e));
  handle(ctx, 'fs:watch', ({ dir }) => (roots.check(dir), watchers.watch(dir)));
  handle(ctx, 'fs:unwatch', ({ watchId }) => watchers.unwatch(watchId));
  app.on('will-quit', () => watchers.closeAll());
  return { closeWatchers: () => watchers.closeAll() };
}
