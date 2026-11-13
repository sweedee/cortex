/** Main process: app lifecycle, the one app window, and the IPC handlers in `./ipc`. */
import { app, BrowserWindow } from 'electron';
import type { EventChannel, EventChannels } from '../shared/ipc';
import { registerIpc } from './ipc';
import { createMainWindow } from './window';

let win: BrowserWindow | null = null;

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
