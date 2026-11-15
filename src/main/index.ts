/** Main process: app lifecycle, the one app window, and the IPC handlers in `./ipc`. */
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { EventChannel, EventChannels } from '../shared/ipc';
import { registerIpc } from './ipc';
import { stripDevEnv } from './lib/devEnv';
import { initLog, installCrashHandlers, log } from './lib/log';
import { migrateUserData, resolveUserData } from './lib/userData';
import { lockDownSessions } from './webSecurity';
import { createMainWindow } from './window';

// dev / test overrides (CORTEX_CLAUDE_BIN, CORTEX_SMOKE*, ELECTRON_RENDERER_URL, …) don't work in an installed app
const ignoredDevEnv = stripDevEnv(process.env, app.isPackaged);

let win: BrowserWindow | null = null;

// Cortex's files in ~/.cortex (or CORTEX_USER_DATA=<dir> for an isolated profile: tests, smoke runs, a
// second dev instance); Chromium's caches stay in Electron's default folder (see lib/userData.ts)
{
  const electronDefault = app.getPath('userData');
  const paths = resolveUserData(process.env, electronDefault);
  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);
  initLog(join(paths.userData, 'logs'));
  installCrashHandlers();
  if (ignoredDevEnv.length) log.warn(`[cortex] ignoring dev-only env in a packaged build: ${ignoredDevEnv.join(', ')}`);
  if (!process.env['CORTEX_USER_DATA']) {
    try {
      const copied = migrateUserData(electronDefault, paths.userData);
      if (copied.length) log.info(`[cortex] moved to ${paths.userData}: ${copied.join(', ')} (copied from ${electronDefault})`);
    } catch (e) {
      log.warn('[cortex] could not copy the old user data', e);
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

  void app.whenReady().then(async () => {
    lockDownSessions();
    // the smoke harness is dev-only: not even loaded in a packaged build
    const smoke = !app.isPackaged && process.env['CORTEX_SMOKE'] === '1' ? await import('./smoke') : null;
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
      if (smoke) {
        // the probe works in this checkout (fs.list, tests.run, the smoke app)
        ipc.allowRoot(process.cwd());
        smoke.runSmoke(win, ipc.allowRoot);
      }
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
