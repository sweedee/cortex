/**
 * The renderer's only door to native functionality. In the desktop app this is the
 * `window.cortex` bridge from the preload; in a plain browser (`npm run dev:web`, unit tests)
 * it is a fallback built from `browserFallbacks()`: exec / proc / fs reject with a clear error,
 * the workspace lives in localStorage and notifications use the Web Notification API.
 *
 * Rule: nothing else in the renderer touches `window.cortex` (or node) directly.
 */
import type { CortexApi, EventChannel, EventChannels, InvokeChannel, NotifyClickedEvent, Req, Res, Unsubscribe } from '../../shared/ipc';
import { buildBridge } from '../../shared/bridge';
import { configProblems, mergePatch, parseUserConfig, RendererConfigPatchSchema, type UserConfigState } from '../../shared/userConfig';

declare global {
  interface Window {
    cortex?: CortexApi;
  }
}

export type { CortexApi } from '../../shared/ipc';

const WORKSPACE_KEY = 'cortex.workspace';
const CONFIG_KEY = 'cortex.config';

/** Browser fallback marker: the channel rejects with "needs the Cortex desktop app". */
export const DESKTOP_ONLY = 'desktop only';
/** Browser fallback marker: the event never fires in the browser. */
export const NEVER_FIRES = 'never fires';

type Fallback<C extends InvokeChannel> = ((req: Req<C>) => Res<C> | Promise<Res<C>>) | typeof DESKTOP_ONLY;
type EventFallback<E extends EventChannel> = ((cb: (payload: EventChannels[E]) => void) => Unsubscribe) | typeof NEVER_FIRES;
export interface BrowserFallbacks {
  invoke: { [C in InvokeChannel]: Fallback<C> };
  events: { [E in EventChannel]: EventFallback<E> };
}

const needsDesktop = (channel: string) => new Error(`${channel} needs the Cortex desktop app (window.cortex is missing; running in a plain browser?)`);
const notInBrowser = () => ({ ok: false, error: 'not available in the browser' });
const empty = () => [];

/** Listeners for an event the browser fallback fires itself. */
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
 * What every channel does without the desktop app: an implementation or `DESKTOP_ONLY` /
 * `NEVER_FIRES`. Typed as a complete map, so a new channel doesn't compile until it says.
 */
export function browserFallbacks(): BrowserFallbacks {
  const clicked = emitter<NotifyClickedEvent>();
  const configChanged = emitter<UserConfigState>();
  return {
    invoke: {
      'exec:run': DESKTOP_ONLY,
      'proc:start': DESKTOP_ONLY,
      'proc:stop': DESKTOP_ONLY,
      'proc:list': empty,
      'dialog:pickDirectory': () => null,
      'dialog:pickFile': () => null,
      'shell:openExternal': ({ url }) => void window.open(url, '_blank', 'noopener'),
      'shell:openPath': notInBrowser,
      'shell:openInEditor': notInBrowser,
      'webview:setColorScheme': () => {},
      'notify:desktop': ({ title, body, tag, itemId }) => {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        const n = new Notification(title, { body, tag, icon: asset('brand/cortex-mark.svg') });
        n.onclick = () => {
          window.focus();
          clicked.emit({ itemId });
          n.close();
        };
      },
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

      // git / gh / jira / claude / apps / tests need the desktop app: lists are empty, actions reject
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
      'notify:clicked': clicked.on,
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

/** The same `CortexApi` shape as the preload's, over `browserFallbacks()`. */
export function browserFallback(fallbacks: BrowserFallbacks = browserFallbacks()): CortexApi {
  return buildBridge(
    async (channel, req) => {
      const f = fallbacks.invoke[channel] as Fallback<InvokeChannel>;
      if (f === DESKTOP_ONLY) throw needsDesktop(channel);
      return f(req as never);
    },
    (channel, cb) => {
      const f = fallbacks.events[channel] as EventFallback<EventChannel>;
      return f === NEVER_FIRES ? () => {} : f(cb as never);
    },
  );
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
