/**
 * Path string helpers shared by the server and the renderer. They work on text only (no `node:path`): paths in the
 * workspace come from several OSes, so both slash styles are understood.
 */

/** `C:\a`, `C:/a`, `\\server\share` or `/a`. `~/…` and relative paths are not absolute. */
export function isAbsolutePath(p: string): boolean;
export function isAbsolutePath(p: string | undefined): p is string;
export function isAbsolutePath(p: string | undefined): boolean {
  return !!p && /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
}

/** The separator a path already uses (`/` unless it is purely backslashed). */
export const sepOf = (p: string): '/' | '\\' => (p.includes('\\') && !p.includes('/') ? '\\' : '/');

/** Last segment, ignoring trailing slashes: `C:\code\app\` → `app`. */
export const baseName = (p: string): string =>
  p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? '';

/** Everything before the last segment (no trailing slash): `a/b/c.md` → `a/b`. */
export const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '');

/**
 * A key to compare paths with: forward slashes, no trailing slashes. Windows paths (drive letter or
 * `\\server\share`) are case-insensitive and get lower-cased; POSIX paths keep their case, since
 * `/a/B` and `/a/b` are different folders on Linux.
 */
export function normPath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(s) || p.startsWith('\\\\') ? s.toLowerCase() : s;
}

/** Same folder? Ignores slash style, trailing slashes and (Windows paths) case. */
export const samePath = (a: string, b: string): boolean => normPath(a) === normPath(b);

/** `p` is `dir` or inside it. */
export const isInsidePath = (p: string, dir: string): boolean => {
  const n = normPath(p);
  const d = normPath(dir);
  return n === d || n.startsWith(d + '/');
};
