import { app, BrowserWindow, dialog, Notification, shell, webContents } from 'electron';
import spawn from 'cross-spawn';
import type { OpenResult } from '../../shared/ipc';
import { isExecutablePath, type Roots } from '../lib/pathPolicy';
import { handle, type IpcContext } from './handle';

/** `dialog:*`, `shell:*`, `notify:*`, `app:*`. */
export function registerDesktop(ctx: IpcContext, roots: Roots) {
  const owner = () => ctx.getWindow() ?? BrowserWindow.getFocusedWindow();

  handle(ctx, 'dialog:pickDirectory', async ({ title, defaultPath }) => {
    const win = owner();
    const opts = { title, defaultPath, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const dir = r.canceled ? null : (r.filePaths[0] ?? null);
    // the user chose it in a native dialog: Cortex may work in it (detect package.json, list records …)
    if (dir) roots.add(dir);
    return dir;
  });
  handle(ctx, 'dialog:pickFile', async ({ title, defaultPath, filters }) => {
    const win = owner();
    const opts = { title, defaultPath, filters, properties: ['openFile'] as 'openFile'[] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = r.canceled ? null : (r.filePaths[0] ?? null);
    if (file) roots.add(file);
    return file;
  });

  handle(ctx, 'shell:openExternal', async ({ url }) => {
    await shell.openExternal(url);
  });
  // folders and documents inside the roots only, never anything the OS would run
  const openRefusal = (path: string) => roots.refusal(path) ?? (isExecutablePath(path) ? 'executable files are not opened' : undefined);
  const openPath = async (path: string): Promise<OpenResult> => {
    const refused = openRefusal(path);
    if (refused) return { ok: false, error: `Not opened: ${refused}` };
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
        const refused = roots.refusal(path);
        if (refused) return resolve({ ok: false, error: `Not opened: ${refused}` });
        const child = spawn('code', [path], { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', () => void openPath(path).then(resolve));
        child.once('spawn', () => {
          child.unref();
          resolve({ ok: true });
        });
      }),
  );

  // Colour-scheme emulation for an embedded <webview> guest. Electron has no API for
  // `prefers-color-scheme` on one page (nativeTheme is app-wide), so use CDP's
  // Emulation.setEmulatedMedia through the debugger, which stays attached for the guest's lifetime.
  handle(ctx, 'webview:setColorScheme', async ({ webContentsId, scheme }) => {
    const wc = webContents.fromId(webContentsId);
    const host = ctx.getWindow()?.webContents;
    // only guests embedded in the app window, never other windows or the app itself
    if (!wc || wc.isDestroyed() || !host || wc.hostWebContents !== host) throw new Error('webview:setColorScheme: not an embedded webview');
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const features = scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : [];
    await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
  });

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
    home: app.getPath('home'),
    version: app.getVersion(),
    electron: process.versions.electron,
  }));
}
