/**
 * Hardening for every web session and every embedded `<webview>` guest (GitHub, Jira, CI, running
 * apps, deployments). The rules themselves are pure functions in `lib/urlPolicy.ts`.
 */
import { app, session, shell, type Session, type WebContents } from 'electron';
import { WEBVIEW_PARTITIONS } from '../shared/ipc';
import { log } from './lib/log';
import { isHttpUrl, permissionAllowed } from './lib/urlPolicy';

const locked = new WeakSet<Session>();

function lockSession(s: Session) {
  if (locked.has(s)) return;
  locked.add(s);
  // camera, mic, location, notifications, … : denied for the app and every embedded page
  s.setPermissionRequestHandler((_wc, permission, cb) => cb(permissionAllowed(permission)));
  s.setPermissionCheckHandler((_wc, permission) => permissionAllowed(permission));
  // no silent downloads into the user's folders: http(s) downloads go to the OS browser instead
  s.on('will-download', (e, item) => {
    e.preventDefault();
    const url = item.getURL();
    log.warn(`[web] download blocked: ${url.slice(0, 200)}`);
    if (isHttpUrl(url)) void shell.openExternal(url);
  });
}

/** Call once when the app is ready: the default session, the app's partitions and any later session. */
export function lockDownSessions() {
  lockSession(session.defaultSession);
  for (const p of WEBVIEW_PARTITIONS) lockSession(session.fromPartition(p));
  app.on('session-created', lockSession);
}

/** An attached `<webview>` guest: http(s) navigations only, popups to the OS browser. */
export function guardGuest(wc: WebContents) {
  const block = (e: { preventDefault(): void }, url: string) => {
    if (isHttpUrl(url)) return;
    e.preventDefault();
    log.warn(`[web] guest navigation blocked: ${url.slice(0, 200)}`);
  };
  wc.on('will-navigate', block);
  wc.on('will-redirect', block);
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}
