/**
 * The renderer's only door to native functionality: the Cortex server (`src/server`), reached with
 * `POST /api/invoke/<channel>` and one reconnecting WebSocket on `/api/events` (both authenticated by
 * the HttpOnly cookie the server set when the page was opened with its token). A few things happen in
 * the browser itself: opening URLs (`shell.openExternal`), desktop notifications (`notify.*`, Web
 * Notification API) and the folder / file picker (`dialog.pickDirectory / pickFile`: a modal that
 * browses the server's disk with `dialog:listDir`, see `setPicker`).
 *
 * Without a `window` (vitest in node) `native` is a fallback built from `browserFallbacks()`: server
 * channels reject with a clear error (lists resolve `[]`), workspace / config live in localStorage.
 *
 * Rule: nothing else in the renderer calls the server (or node) directly.
 */
import type { CortexApi, DesktopNotification, EventChannel, EventChannels, InvokeChannel, NotifyClickedEvent, PickDirectoryRequest, PickFileRequest, Req, Res, Unsubscribe } from '../../shared/ipc';
import { buildBridge, type BridgeInvoke, type BridgeOn } from '../../shared/bridge';
import { encodeIpcError, type IpcErrorCode, type IpcErrorPayload } from '../../shared/ipcError';
import { configProblems, mergePatch, parseUserConfig, RendererConfigPatchSchema, type UserConfigState } from '../../shared/userConfig';

export type { CortexApi } from '../../shared/ipc';

const WORKSPACE_KEY = 'cortex.workspace';
const CONFIG_KEY = 'cortex.config';

/** Fallback marker: the channel rejects with "needs the Cortex server". */
export const DESKTOP_ONLY = 'server only';
/** Fallback marker: the event never fires without the server. */
export const NEVER_FIRES = 'never fires';

type Fallback<C extends InvokeChannel> = ((req: Req<C>) => Res<C> | Promise<Res<C>>) | typeof DESKTOP_ONLY;
type EventFallback<E extends EventChannel> = ((cb: (payload: EventChannels[E]) => void) => Unsubscribe) | typeof NEVER_FIRES;
export interface BrowserFallbacks {
  invoke: { [C in InvokeChannel]: Fallback<C> };
  events: { [E in EventChannel]: EventFallback<E> };
}

const needsServer = (channel: string) => new Error(`${channel} needs the Cortex server (not available in this test / fallback environment)`);
const notInBrowser = () => ({ ok: false, error: 'not available without the Cortex server' });
const empty = () => [];

/** Listeners for an event the renderer fires itself. */
function emitter<T>() {
  const cbs = new Set<(payload: T) => void>();
  return {
    emit: (payload: T) => cbs.forEach((cb) => cb(payload)),
    on: (cb: (payload: T) => void) => {
      cbs.add(cb);
      return () => void cbs.delete(cb);
    },
  };
}

function readConfig(): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const configState = (r: Record<string, unknown>): UserConfigState => ({ config: parseUserConfig(r), path: `localStorage:${CONFIG_KEY}`, problems: configProblems(r) });

/**
 * What every channel does without the server (unit tests): an implementation or `DESKTOP_ONLY` /
 * `NEVER_FIRES`. Typed as a complete map, so a new channel doesn't compile until it says.
 */
export function browserFallbacks(): BrowserFallbacks {
  const configChanged = emitter<UserConfigState>();
  return {
    invoke: {
      'exec:run': DESKTOP_ONLY,
      'proc:start': DESKTOP_ONLY,
      'proc:stop': DESKTOP_ONLY,
      'proc:list': empty,
      'dialog:listDir': DESKTOP_ONLY,
      'dialog:confirmPick': DESKTOP_ONLY,
      'shell:openPath': notInBrowser,
      'shell:openInEditor': notInBrowser,
      'workspace:load': () => {
        try {
          const raw = localStorage.getItem(WORKSPACE_KEY);
          return raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
          return null;
        }
      },
      'workspace:save': ({ data }) => {
        try {
          localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
        } catch {
          /* private mode / quota */
        }
      },
      'workspace:path': () => `localStorage:${WORKSPACE_KEY}`,
      'fs:readText': DESKTOP_ONLY,
      'fs:writeText': DESKTOP_ONLY,
      'fs:list': DESKTOP_ONLY,
      'fs:watch': DESKTOP_ONLY,
      'fs:unwatch': () => {},
      'fs:setRoots': empty,
      'app:info': () => ({ platform: 'browser', userData: '', version: 'dev' }),

      // git / gh / jira / claude / apps / tests need the server: lists are empty, actions reject
      'integrations:config': DESKTOP_ONLY,
      'git:isRepo': DESKTOP_ONLY,
      'git:currentBranch': DESKTOP_ONLY,
      'git:remoteRepo': DESKTOP_ONLY,
      'git:worktreeList': DESKTOP_ONLY,
      'git:worktreeAdd': DESKTOP_ONLY,
      'git:worktreeRemove': DESKTOP_ONLY,
      'git:status': DESKTOP_ONLY,
      'git:diff': DESKTOP_ONLY,
      'git:diffStat': DESKTOP_ONLY,
      'git:log': DESKTOP_ONLY,
      'git:fetch': DESKTOP_ONLY,
      'git:rebase': DESKTOP_ONLY,
      'git:rebaseAbort': DESKTOP_ONLY,
      'git:push': DESKTOP_ONLY,
      'gh:prList': DESKTOP_ONLY,
      'gh:prView': DESKTOP_ONLY,
      'gh:prCreate': DESKTOP_ONLY,
      'gh:prMerge': DESKTOP_ONLY,
      'gh:prComment': DESKTOP_ONLY,
      'gh:prUpdateBranch': DESKTOP_ONLY,
      'gh:prEdit': DESKTOP_ONLY,
      'gh:prDiff': DESKTOP_ONLY,
      'gh:prChecks': DESKTOP_ONLY,
      'gh:runView': DESKTOP_ONLY,
      'gh:runRerun': DESKTOP_ONLY,
      'gh:renovatePrs': DESKTOP_ONLY,
      'jira:search': DESKTOP_ONLY,
      'jira:view': DESKTOP_ONLY,
      'jira:transition': DESKTOP_ONLY,
      'jira:create': DESKTOP_ONLY,
      'jira:comment': DESKTOP_ONLY,
      'jira:edit': DESKTOP_ONLY,
      'jira:statuses': DESKTOP_ONLY,
      'claude:start': DESKTOP_ONLY,
      'claude:send': DESKTOP_ONLY,
      'claude:answer': DESKTOP_ONLY,
      'claude:permission': DESKTOP_ONLY,
      'claude:interrupt': DESKTOP_ONLY,
      'claude:stop': DESKTOP_ONLY,
      'claude:remove': DESKTOP_ONLY,
      'claude:list': empty,
      'claude:transcript': DESKTOP_ONLY,
      'claude:session': DESKTOP_ONLY,
      'claude:configure': DESKTOP_ONLY,
      'claude:catalog': () => ({ commands: [], models: [] }),
      'apps:start': DESKTOP_ONLY,
      'apps:stop': DESKTOP_ONLY,
      'apps:restart': DESKTOP_ONLY,
      'apps:list': empty,
      'apps:log': DESKTOP_ONLY,
      'apps:remove': DESKTOP_ONLY,
      'tests:run': DESKTOP_ONLY,
      'tests:stop': DESKTOP_ONLY,
      'tests:list': empty,
      'tests:log': DESKTOP_ONLY,

      // config.json in the browser: the same schema and patch rules, kept in localStorage
      'config:get': () => configState(readConfig()),
      'config:update': ({ patch, ifUnset }) => {
        const next = mergePatch(readConfig(), RendererConfigPatchSchema.parse(patch), ifUnset);
        try {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        } catch {
          /* private mode / quota */
        }
        const s = configState(next);
        configChanged.emit(s);
        return s;
      },
    },
    events: {
      'proc:output': NEVER_FIRES,
      'proc:exit': NEVER_FIRES,
      'fs:changed': NEVER_FIRES,
      'claude:event': NEVER_FIRES,
      'claude:state': NEVER_FIRES,
      'app:state': NEVER_FIRES,
      'app:output': NEVER_FIRES,
      'test:state': NEVER_FIRES,
      'test:output': NEVER_FIRES,
      'config:changed': configChanged.on,
    },
  };
}

/** The same `CortexApi` shape as the server transport's, over `browserFallbacks()`. */
export function browserFallback(fallbacks: BrowserFallbacks = browserFallbacks()): CortexApi {
  return buildBridge(
    async (channel, req) => {
      const f = fallbacks.invoke[channel] as Fallback<InvokeChannel>;
      if (f === DESKTOP_ONLY) throw needsServer(channel);
      return f(req as never);
    },
    (channel, cb) => {
      const f = fallbacks.events[channel] as EventFallback<EventChannel>;
      return f === NEVER_FIRES ? () => {} : f(cb as never);
    },
  );
}

// ---- the server transport ------------------------------------------------------------------

const ERROR_CODES: readonly string[] = ['CLI_MISSING', 'TIMEOUT', 'EXIT', 'PARSE', 'VALIDATION', 'FORBIDDEN', 'UNKNOWN'];

/** The Error a failed call rejects with: its message is the encoded payload, as `shared/ipcError.ts` decodes it. */
const callError = (p: IpcErrorPayload) => new Error(encodeIpcError(p));

/** the server's `{ error }` body, or one made up from the HTTP status */
function errorFrom(channel: string, status: number, body: unknown): IpcErrorPayload {
  const e = (body as { error?: Partial<IpcErrorPayload> } | undefined)?.error;
  if (e && typeof e.message === 'string' && typeof e.code === 'string' && ERROR_CODES.includes(e.code)) return e as IpcErrorPayload;
  const code: IpcErrorCode = status === 401 || status === 403 ? 'FORBIDDEN' : status === 400 || status === 413 || status === 415 ? 'VALIDATION' : 'UNKNOWN';
  const message = status === 401 ? 'Not signed in to the Cortex server: open the URL it printed when it started' : `${channel} failed (HTTP ${status})`;
  return { code, message };
}

const randomId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

/** Connection state of the event socket (for a status indicator). */
export type ServerConnection = 'connecting' | 'open' | 'closed';

/** The `CortexApi` over the server: fetch for calls, one reconnecting WebSocket for events (exported for tests). */
export function serverTransport() {
  // identifies this tab to the server: its fs watches close when this tab's socket is gone
  const clientId = randomId();
  const invoke: BridgeInvoke = async (channel, req) => {
    let res: Response;
    try {
      res = await fetch(`/api/invoke/${encodeURIComponent(channel)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Cortex-Client': clientId },
        body: req === undefined ? undefined : JSON.stringify(req),
      });
    } catch (e) {
      throw callError({ code: 'UNKNOWN', message: `Cortex server not reachable (${channel}): ${e instanceof Error ? e.message : String(e)}` });
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (res.ok) return body;
    throw callError(errorFrom(channel, res.status, body));
  };

  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const status = emitter<ServerConnection>();
  let state: ServerConnection = 'connecting';
  const setState = (s: ServerConnection) => {
    if (s === state) return;
    state = s;
    status.emit(s);
  };
  let delay = 500;
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/events?client=${encodeURIComponent(clientId)}`);
    ws.onopen = () => {
      delay = 500;
      setState('open');
    };
    ws.onmessage = (e) => {
      let msg: { channel?: unknown; payload?: unknown };
      try {
        msg = JSON.parse(String(e.data)) as typeof msg;
      } catch {
        return;
      }
      if (typeof msg.channel !== 'string') return;
      for (const cb of listeners.get(msg.channel) ?? []) {
        try {
          cb(msg.payload);
        } catch (err) {
          console.error(`[native] ${msg.channel} listener failed`, err);
        }
      }
    };
    // server restarted / laptop slept: keep trying, backing off to 5 s
    ws.onclose = () => {
      setState('closed');
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5000);
    };
  };
  connect();

  const on: BridgeOn = (channel, cb) => {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    const fn = cb as (payload: unknown) => void;
    set.add(fn);
    return () => void set.delete(fn);
  };
  return { api: buildBridge(invoke, on), onConnection: status.on, connection: () => state };
}

// ---- in the browser itself: URLs, notifications, the picker -----------------------------------

/** What the picker modal is asked for. */
export interface PickRequest {
  kind: 'dir' | 'file';
  title?: string;
  defaultPath?: string;
  /** file picks: which extensions to offer */
  filters?: PickFileRequest['filters'];
}

/**
 * The folder / file picker: shows a modal that browses with `native.dialog.listDir`, sends the
 * user's choice through `native.dialog.confirmPick` (which validates it and allows it as a root) and
 * resolves with the path that returned, or null when cancelled.
 */
export type Picker = (req: PickRequest) => Promise<string | null>;

/** Stand-in until a picker modal is registered: ask for the path in a prompt. */
const promptPicker: Picker = async (req) => {
  const what = req.kind === 'dir' ? 'folder' : 'file';
  const typed = window.prompt(`${req.title ?? `Choose a ${what}`}\n\nAbsolute path of the ${what}:`, req.defaultPath ?? '');
  if (!typed?.trim()) return null;
  return native.dialog.confirmPick({ path: typed.trim(), kind: req.kind });
};

let picker: Picker = promptPicker;

/** The picker modal registers itself here (once, at startup); returns a function that unregisters it. */
export function setPicker(p: Picker): () => void {
  picker = p;
  return () => {
    if (picker === p) picker = promptPicker;
  };
}

const clicked = emitter<NotifyClickedEvent>();

/** Renderer-side helpers that look like channels: `native.dialog.pickDirectory`, `native.shell.openExternal`, `native.notify.*`. */
export interface LocalApi {
  dialog: {
    pickDirectory(req?: PickDirectoryRequest): Promise<string | null>;
    pickFile(req?: PickFileRequest): Promise<string | null>;
  };
  shell: { openExternal(req: { url: string }): Promise<void> };
  notify: {
    /** a Web Notification (permission must be granted); a click focuses the tab and fires `onClicked` */
    desktop(n: DesktopNotification): Promise<void>;
    onClicked(cb: (e: NotifyClickedEvent) => void): Unsubscribe;
  };
}

export type NativeApi = Omit<CortexApi, 'dialog' | 'shell'> & {
  dialog: CortexApi['dialog'] & LocalApi['dialog'];
  shell: CortexApi['shell'] & LocalApi['shell'];
  notify: LocalApi['notify'];
};

const local: LocalApi = {
  dialog: {
    pickDirectory: async (req = {}) => picker({ kind: 'dir', ...req }),
    pickFile: async (req = {}) => picker({ kind: 'file', ...req }),
  },
  shell: {
    async openExternal({ url }) {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) URLs can be opened');
      window.open(u.href, '_blank', 'noopener,noreferrer');
    },
  },
  notify: {
    async desktop({ title, body, tag, itemId }) {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification(title, { body, tag, icon: asset('brand/cortex-mark.svg') });
      n.onclick = () => {
        window.focus();
        clicked.emit({ itemId });
        n.close();
      };
    },
    onClicked: clicked.on,
  },
};

function withLocal(api: CortexApi): NativeApi {
  return { ...api, dialog: { ...api.dialog, ...local.dialog }, shell: { ...api.shell, ...local.shell }, notify: local.notify };
}

/** the Cortex server is there (always in the app; false in unit tests, which use the fallback) */
export const isDesktop = typeof window !== 'undefined' && typeof WebSocket !== 'undefined';

const transport = isDesktop ? serverTransport() : null;

export const native: NativeApi = withLocal(transport?.api ?? browserFallback());

/** Event socket state changes ('connecting' → 'open' / 'closed'); no-op without the server. */
export const onServerConnection = (cb: (s: ServerConnection) => void): Unsubscribe => transport?.onConnection(cb) ?? (() => {});
export const serverConnection = (): ServerConnection => transport?.connection() ?? 'closed';

/** URL of a file in /public. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

/** Can desktop notifications be shown right now (permission granted)? */
export const notifyPermitted = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

/** Ask for notification permission where needed. */
export async function requestNotifyPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  return p === 'granted' ? 'granted' : 'denied';
}
