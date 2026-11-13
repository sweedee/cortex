/**
 * The renderer's only door to native functionality. In the desktop app this is the
 * `window.cortex` bridge from the preload; in a plain browser (`npm run dev:web`, unit tests)
 * it is a fallback: exec / proc / fs reject with a clear error, the workspace lives in
 * localStorage and notifications use the Web Notification API.
 *
 * Rule: nothing else in the renderer touches `window.cortex` (or node) directly.
 */
import type { CortexApi, NotifyClickedEvent } from '../../shared/ipc';

declare global {
  interface Window {
    cortex?: CortexApi;
  }
}

export type { CortexApi } from '../../shared/ipc';

const WORKSPACE_KEY = 'cortex.workspace';

const needsDesktop = (what: string) => () => Promise.reject(new Error(`${what} needs the Cortex desktop app (window.cortex is missing; running in a plain browser?)`));
const noop = () => () => {};

function browserFallback(): CortexApi {
  const clicked = new Set<(e: NotifyClickedEvent) => void>();
  return {
    exec: { run: needsDesktop('exec.run') },
    proc: { start: needsDesktop('proc.start'), stop: needsDesktop('proc.stop'), list: () => Promise.resolve([]), onOutput: noop, onExit: noop },
    dialog: { pickDirectory: () => Promise.resolve(null), pickFile: () => Promise.resolve(null) },
    shell: {
      openExternal: async (url) => void window.open(url, '_blank', 'noopener'),
      openPath: async () => ({ ok: false, error: 'not available in the browser' }),
      openInEditor: async () => ({ ok: false, error: 'not available in the browser' }),
    },
    notify: {
      desktop: async ({ title, body, tag, itemId }) => {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        const n = new Notification(title, { body, tag, icon: asset('brand/cortex-mark.svg') });
        n.onclick = () => {
          window.focus();
          clicked.forEach((cb) => cb({ itemId }));
          n.close();
        };
      },
      onClicked: (cb) => {
        clicked.add(cb);
        return () => void clicked.delete(cb);
      },
    },
    workspace: {
      load: async () => {
        try {
          const raw = localStorage.getItem(WORKSPACE_KEY);
          return raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
          return null;
        }
      },
      save: async (data) => {
        try {
          localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
        } catch {
          /* private mode / quota */
        }
      },
      path: async () => `localStorage:${WORKSPACE_KEY}`,
    },
    fs: {
      readText: needsDesktop('fs.readText'),
      writeText: needsDesktop('fs.writeText'),
      list: needsDesktop('fs.list'),
      watch: needsDesktop('fs.watch'),
      unwatch: async () => {},
      onChanged: noop,
    },
    app: { info: async () => ({ platform: 'browser', userData: '', version: 'dev' }) },
  };
}

/** running inside the Electron shell? */
export const isDesktop = typeof window !== 'undefined' && !!window.cortex;

export const native: CortexApi = (typeof window !== 'undefined' && window.cortex) || browserFallback();

/** URL of a file in /public that works over http (dev) and file:// (packaged build). */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

/** Can desktop notifications be shown right now (browser: permission granted)? */
export const notifyPermitted = () => isDesktop || (typeof Notification !== 'undefined' && Notification.permission === 'granted');

/** Ask for notification permission where needed (only the browser fallback asks). */
export async function requestNotifyPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (isDesktop) return 'granted';
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  return p === 'granted' ? 'granted' : 'denied';
}
