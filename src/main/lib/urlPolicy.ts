/**
 * URL and permission rules for the app window and the embedded `<webview>` guests (window.ts).
 * Pure, so they are unit-tested without Electron.
 */
import { WEBVIEW_PARTITIONS } from '../../shared/ipc';

const parse = (url: string | undefined): URL | null => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** http: or https: (parsed, not pattern-matched) */
export function isHttpUrl(url: string | undefined): boolean {
  const u = parse(url);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
}

/** same scheme + host + port; opaque origins (file:, data:, about:) never match */
export function sameOrigin(a: string | undefined, b: string | undefined): boolean {
  const x = parse(a);
  const y = parse(b);
  return !!x && !!y && x.origin !== 'null' && x.origin === y.origin;
}

const partitions = new Set<string>(WEBVIEW_PARTITIONS);

/** why a `<webview>` may not attach, or undefined: http(s) `src` and one of the app's partitions only */
export function webviewRefusal(src: string | undefined, partition: string | undefined): string | undefined {
  if (!isHttpUrl(src)) return `src must be http(s), got ${JSON.stringify((src ?? '').slice(0, 100))}`;
  if (!partition || !partitions.has(partition)) return `unknown partition ${JSON.stringify(partition ?? '')}`;
  return undefined;
}

/**
 * Web permissions (camera, mic, geolocation, notifications, MIDI, HID, …) for every session: denied.
 * Only a sanitized clipboard write is allowed, so "copy" buttons on GitHub / Jira keep working.
 */
export function permissionAllowed(permission: string): boolean {
  return permission === 'clipboard-sanitized-write';
}
