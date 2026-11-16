import { homedir } from 'node:os';
import spawn from 'cross-spawn';
import type { OpenResult } from '../../shared/ipc';
import { editorArgs, type UserConfig } from '../../shared/userConfig';
import { browseDir, checkPick } from '../lib/browse';
import { isExecutablePath, type PathEnv, type Roots } from '../lib/pathPolicy';
import { handle, type IpcContext } from './handle';

/** The OS's "open with the default app" launcher (no shell: the path is one argument). */
export function osOpener(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'explorer';
  return 'xdg-open';
}

/** Start `command args…` detached; resolves ok once it spawned, or the spawn error. */
function launch(command: string, args: string[]): Promise<OpenResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.once('error', (e) => resolve({ ok: false, error: e.message }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

export interface DesktopOptions {
  roots: Roots;
  pathEnv: PathEnv;
  editor: () => UserConfig['editor'];
  version: string;
}

/**
 * `dialog:*` (the picker modal's disk browsing), `shell:*` (open in the OS / the editor; the server
 * runs on the user's machine) and `app:*`. Opening URLs and notifications happen in the browser.
 */
export function registerDesktop(ctx: IpcContext, { roots, pathEnv, editor, version }: DesktopOptions) {
  handle(ctx, 'dialog:listDir', ({ path }) => browseDir(path, pathEnv));
  // the user chose it in the picker: Cortex may work in it (detect package.json, list records …)
  handle(ctx, 'dialog:confirmPick', async ({ path, kind }) => {
    const p = await checkPick(path, kind);
    roots.add(p);
    return p;
  });

  // folders and documents inside the roots only, never anything the OS would run
  const openRefusal = (path: string) => roots.refusal(path) ?? (isExecutablePath(path) ? 'executable files are not opened' : undefined);
  const openPath = async (path: string): Promise<OpenResult> => {
    const refused = openRefusal(path);
    if (refused) return { ok: false, error: `Not opened: ${refused}` };
    return launch(osOpener(), [path]);
  };
  handle(ctx, 'shell:openPath', ({ path }) => openPath(path));
  // config.json `editor` (default VS Code's `code` CLI, a .cmd shim on Windows, hence cross-spawn; no
  // shell). The command comes from the file only, never from the renderer; the renderer gives the path,
  // which is inside the roots and becomes one argument. OS default when the editor can't be started.
  handle(ctx, 'shell:openInEditor', async ({ path }) => {
    const refused = roots.refusal(path);
    if (refused) return { ok: false, error: `Not opened: ${refused}` };
    const { command, args } = editor();
    const r = await launch(command, editorArgs(args, path));
    return r.ok ? r : openPath(path);
  });

  handle(ctx, 'app:info', () => ({
    platform: process.platform,
    userData: pathEnv.userData,
    home: homedir(),
    version,
    node: process.versions.node,
  }));
}
