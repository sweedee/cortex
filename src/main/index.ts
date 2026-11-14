/** Main process: app lifecycle, the one app window, and the IPC handlers in `./ipc`. */
import { app, BrowserWindow } from 'electron';
import type { EventChannel, EventChannels } from '../shared/ipc';
import { registerIpc } from './ipc';
import { migrateUserData, resolveUserData } from './lib/userData';
import { runSmoke } from './smoke';
import { createMainWindow } from './window';

let win: BrowserWindow | null = null;

// Cortex's files in ~/.cortex (or CORTEX_USER_DATA=<dir> for an isolated profile: tests, smoke runs, a
// second dev instance); Chromium's caches stay in Electron's default folder (see lib/userData.ts)
{
  const electronDefault = app.getPath('userData');
  const paths = resolveUserData(process.env, electronDefault);
  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);
  if (!process.env['CORTEX_USER_DATA']) {
    try {
      const copied = migrateUserData(electronDefault, paths.userData);
      if (copied.length) console.log(`[cortex] moved to ${paths.userData}: ${copied.join(', ')} (copied from ${electronDefault})`);
    } catch (e) {
      console.warn('[cortex] could not copy the old user data', e);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Windows shows notifications only for apps with an AppUserModelID; in dev that is electron.exe
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'dev.cortex.app' : process.execPath);

  void app.whenReady().then(() => {
    const ipc = registerIpc({
      getWindow: () => (win && !win.isDestroyed() ? win : null),
      send<C extends EventChannel>(channel: C, payload: EventChannels[C]) {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      },
    });
    const open = () => {
      win = createMainWindow();
      // a reload starts a fresh renderer that knows none of the old watch ids
      win.webContents.on('did-navigate', () => ipc.closeWatchers());
      win.on('closed', () => (win = null));
      if (process.env['CORTEX_SMOKE'] === '1') runSmoke(win);
    };
    open();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) open();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
