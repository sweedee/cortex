/**
 * The built renderer (`out/renderer`) over http: files by extension MIME type, anything else that
 * looks like a page → `index.html` (SPA fallback). Paths are decoded, resolved and must stay inside
 * the root (no `..`, no NUL, no absolute escapes); dot-files are never served.
 */
import { createReadStream, promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export const mimeType = (file: string) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';

/** The file under `root` that `urlPath` names, or null when it would leave the root / is not a plain path. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\')) return null;
  const segments = p.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  const base = resolve(root);
  const file = resolve(base, ...segments);
  return file === base || file.startsWith(base + sep) ? file : null;
}

export interface StaticResult {
  file: string;
  /** index.html: the page (gets the CSP, never cached) */
  html: boolean;
}

/** What to send for GET `urlPath`: the file, the SPA fallback, or null (404). */
export async function findStatic(root: string, urlPath: string): Promise<StaticResult | null> {
  const file = resolveStatic(root, urlPath);
  if (!file) return null;
  const st = await fs.stat(file).catch(() => null);
  if (st?.isFile()) return { file, html: extname(file).toLowerCase() === '.html' };
  // a client-side route (no extension): the app page; a missing asset stays a 404
  if (!extname(file) || st?.isDirectory()) {
    const index = resolve(root, 'index.html');
    if (
      await fs.stat(index).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      return { file: index, html: true };
  }
  return null;
}

export function sendFile(res: ServerResponse, found: StaticResult, headers: Record<string, string>, head = false): void {
  res.statusCode = 200;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', mimeType(found.file));
  // Vite's hashed assets never change; the page must always be fresh
  res.setHeader('Cache-Control', found.html ? 'no-store' : found.file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (head) return void res.end();
  const stream = createReadStream(found.file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
