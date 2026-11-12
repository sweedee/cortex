/**
 * The notification list: what sync.ts detected (state/notify.ts), minus what the user is looking at or
 * just did themselves, persisted in localStorage like the todos. Navigation lives in actions.ts
 * (`openNotification`); the toasts and desktop notifications are shown by shell/NotificationToasts.tsx.
 */
import type { CortexNotification, Notice, NotificationKind } from '../model/types';
import { isInView } from './notify';
import { newId, persistSlice } from './persist';
import { getState, setState } from './store';

const STORAGE_KEY = 'cortex.notifications.v1';
const DESKTOP_KEY = 'cortex.notifications.desktop.v1';
/** the list keeps this many, newest first */
export const MAX_NOTIFICATIONS = 100;
/** an identical notice within this time is a duplicate (a stale refresh that raced with a newer one) */
const DUPLICATE_MS = 60_000;
/** how long after my own click its direct result stays silent */
const OWN_ACTION_MS = 45_000;

export const initNotifications = () => persistSlice('notifications', STORAGE_KEY, []);

// ---- my own clicks stay silent ---------------------------------------------------------

const muted = new Map<string, number>();

/** Call before an action whose direct result would otherwise notify me (merge → "merged", approve → "approved"). */
export function muteNotifications(workId: string, kinds: NotificationKind[], ms = OWN_ACTION_MS) {
  for (const kind of kinds) muted.set(`${workId}:${kind}`, Date.now() + ms);
}

const isMuted = (n: Notice) => !!n.workId && (muted.get(`${n.workId}:${n.kind}`) ?? 0) > Date.now();

// ---- adding ------------------------------------------------------------------------------

/**
 * Adds detected notices unless they are about what is on screen right now (visible browser tab, that
 * tab / session open), the direct result of my own click, or a duplicate. Returns what was added.
 */
export function pushNotices(notices: Notice[]): CortexNotification[] {
  const { view, sessions, notifications } = getState();
  const seeing = typeof document !== 'undefined' && !document.hidden;
  const now = Date.now();
  const added: CortexNotification[] = [];
  for (const n of notices) {
    if (isMuted(n) || (seeing && isInView(n, view, sessions))) continue;
    const dup = [...added, ...notifications].some(
      (o) => o.kind === n.kind && o.workId === n.workId && o.sessionId === n.sessionId && o.title === n.title && o.detail === n.detail && now - Date.parse(o.at) < DUPLICATE_MS,
    );
    if (dup) continue;
    added.unshift({ ...n, id: newId('n'), at: new Date(now).toISOString(), read: false });
  }
  if (added.length > 0) setState((s) => ({ ...s, notifications: [...added, ...s.notifications].slice(0, MAX_NOTIFICATIONS) }));
  return added;
}

// ---- reading -----------------------------------------------------------------------------

const patch = (fn: (list: CortexNotification[]) => CortexNotification[]) => setState((s) => ({ ...s, notifications: fn(s.notifications) }));

export const markNotificationRead = (id: string) => patch((l) => l.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)));
export const markAllNotificationsRead = () => patch((l) => (l.some((n) => !n.read) ? l.map((n) => (n.read ? n : { ...n, read: true })) : l));
export const clearNotifications = () => patch(() => []);

// ---- desktop notifications (opt-in) ------------------------------------------------------

const api = () => (typeof Notification === 'undefined' ? undefined : Notification);

export const desktopSupported = () => !!api();

/** Remembered choice and a permission that is still granted. */
export function desktopEnabled(): boolean {
  try {
    return api()?.permission === 'granted' && localStorage.getItem(DESKTOP_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Turning it on asks the browser for permission (only then). Resolves to whether it is on now. */
export async function setDesktopEnabled(on: boolean): Promise<boolean> {
  const N = api();
  if (!N) return false;
  try {
    if (on && N.permission !== 'granted') {
      if ((await N.requestPermission()) !== 'granted') return false; // (resolves at once when the user blocked the site earlier)
    }
    localStorage.setItem(DESKTOP_KEY, on ? 'on' : 'off');
  } catch {
    return false; // storage or API not available: stays off
  }
  return on;
}

/** The browser's own notification, only while the window is not focused. `onOpen` runs when it is clicked. */
export function showDesktopNotification(n: CortexNotification, onOpen: () => void) {
  const N = api();
  if (!N || !desktopEnabled() || document.hasFocus()) return;
  try {
    const shown = new N(n.title, { body: [n.subject, n.detail].filter(Boolean).join(' · '), tag: n.id });
    shown.onclick = () => {
      window.focus();
      onOpen();
      shown.close();
    };
  } catch {
    // some browsers only allow notifications through a service worker: silently nothing
  }
}
