import { app, BrowserWindow, dialog, Notification, shell } from 'electron';
import spawn from 'cross-spawn';
import type { OpenResult } from '../../shared/ipc';
import { handle, type IpcContext } from './handle';

/** `dialog:*`, `shell:*`, `notify:*`, `app:*`. */
export function registerDesktop(ctx: IpcContext) {
  const owner = () => ctx.getWindow() ?? BrowserWindow.getFocusedWindow();

  handle(ctx, 'dialog:pickDirectory', async ({ title, defaultPath }) => {
    const win = owner();
    const opts = { title, defaultPath, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  handle(ctx, 'dialog:pickFile', async ({ title, defaultPath, filters }) => {
    const win = owner();
    const opts = { title, defaultPath, filters, properties: ['openFile'] as 'openFile'[] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  handle(ctx, 'shell:openExternal', async ({ url }) => {
    await shell.openExternal(url);
  });
  const openPath = async (path: string): Promise<OpenResult> => {
    const error = await shell.openPath(path);
    return error ? { ok: false, error } : { ok: true };
  };
  handle(ctx, 'shell:openPath', ({ path }) => openPath(path));
  // VS Code's `code` CLI (a .cmd shim on Windows, hence cross-spawn); OS default otherwise
  handle(
    ctx,
    'shell:openInEditor',
    ({ path }) =>
      new Promise<OpenResult>((resolve) => {
        const child = spawn('code', [path], { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', () => void openPath(path).then(resolve));
        child.once('spawn', () => {
          child.unref();
          resolve({ ok: true });
        });
      }),
  );

  // Electron drops click handlers of notifications that get garbage collected; keep them.
  const live = new Set<Notification>();
  handle(ctx, 'notify:desktop', ({ title, body, itemId }) => {
    if (!Notification.isSupported()) return;
    // no icon: nativeImage can't load our SVG mark; Windows shows the app icon instead
    const n = new Notification({ title, body });
    live.add(n);
    const drop = () => live.delete(n);
    n.on('click', () => {
      drop();
      const win = ctx.getWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      ctx.send('notify:clicked', { itemId });
    });
    n.on('close', drop);
    n.on('failed', drop);
    n.show();
  });

  handle(ctx, 'app:info', () => ({
    platform: process.platform,
    userData: app.getPath('userData'),
    version: app.getVersion(),
    electron: process.versions.electron,
  }));
}
