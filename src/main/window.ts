import { app, BrowserWindow, dialog, screen, shell, type Rectangle, type WebContents } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './lib/log';

/** matches `--canvas-bg` in the renderer, so there is no white flash before first paint */
const BACKGROUND = '#07080f';

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

/** saved size; the position only when it is still (mostly) on an existing display */
function loadState(): { width: number; height: number; x?: number; y?: number; maximized: boolean } | null {
  try {
    const { bounds: b, maximized } = JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
    const visible = screen
      .getAllDisplays()
      .some(({ workArea: d }) => b.x + 100 < d.x + d.width && b.x + b.width - 100 > d.x && b.y >= d.y - 20 && b.y + 40 < d.y + d.height);
    return visible ? { ...b, maximized } : { width: b.width, height: b.height, maximized };
  } catch {
    return null;
  }
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);

/** window.open / target=_blank: open http(s) in the OS browser, never in a new Electron window */
function externalLinks(wc: WebContents) {
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

export function createMainWindow(): BrowserWindow {
  const saved = loadState();
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'Cortex',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // later phases embed GitHub / Jira / running apps in <webview>
      webviewTag: true,
      // notification chimes (Web Audio) without a prior click
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (saved?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // ---- remember bounds ----
  let timer: ReturnType<typeof setTimeout> | undefined;
  // synchronous (tiny file): the last write happens on close, right before the process exits
  const persist = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      const tmp = `${stateFile()}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, stateFile());
    } catch (err) {
      console.warn('[window] could not save bounds:', (err as Error).message);
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, 400);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('close', () => {
    clearTimeout(timer);
    persist();
  });

  // ---- navigation / links ----
  externalLinks(win.webContents);
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return; // reload
    e.preventDefault();
    if (isHttp(url) && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\0')) void shell.openExternal(url);
  });
  // embedded <webview>s: no preload, no node, their popups go to the OS browser too
  win.webContents.on('will-attach-webview', (_e, prefs) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
  });
  win.webContents.on('did-attach-webview', (_e, wc) => externalLinks(wc));

  // surface renderer problems in the terminal (dev runs are often headless / unattended)
  win.webContents.on('preload-error', (_e, path, err) => log.error(`[preload] ${path}: ${err.message}`));
  win.webContents.on('render-process-gone', (_e, d) => {
    log.error(`[renderer] gone: ${d.reason} (${d.exitCode})`);
    if (d.reason === 'clean-exit' || win.isDestroyed()) return;
    void dialog
      .showMessageBox(win, { type: 'error', message: 'The Cortex window crashed.', detail: `Reason: ${d.reason}. Your workspace is saved; reload to continue.`, buttons: ['Reload', 'Quit'], defaultId: 0, cancelId: 1 })
      .then(({ response }) => (response === 0 && !win.isDestroyed() ? win.reload() : app.quit()));
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log.error(`[renderer] failed to load ${url}: ${desc} (${code})`));
  win.webContents.on('did-finish-load', () => console.log(`[renderer] loaded ${win.webContents.getURL()}`));
  if (!app.isPackaged) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // #smoke exposes the renderer's debug handle (debug.ts) to the smoke probe, also in a build
  const smoke = process.env['CORTEX_SMOKE'] === '1';
  if (!app.isPackaged && devUrl) void win.loadURL(smoke ? `${devUrl}#smoke` : devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), smoke ? { hash: 'smoke' } : undefined);
  return win;
}
