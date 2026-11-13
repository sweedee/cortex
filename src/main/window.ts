import { app, BrowserWindow, screen, shell, type Rectangle, type WebContents } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './lib/atomicWrite';

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
  const persist = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    void atomicWrite(stateFile(), JSON.stringify(state)).catch(() => {});
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

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}
