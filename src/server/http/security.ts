/**
 * Who may talk to the server. It runs git / gh / claude and arbitrary user commands on this machine,
 * so it only listens on 127.0.0.1 and every request must:
 *   - name this server in `Host` (127.0.0.1:PORT / localhost:PORT): no DNS rebinding;
 *   - carry no `Origin`, or an allowed local one (the server's own, plus the Vite dev origin in dev);
 *   - be authenticated: the per-start token, as the HttpOnly SameSite=Strict cookie that opening
 *     `/?token=…` sets, or `Authorization: Bearer <token>` (tests, scripts).
 * Pure helpers; `app.ts` applies them.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface SecurityConfig {
  port: number;
  token: string;
  /** extra allowed origins, e.g. the Vite dev server `http://127.0.0.1:5173` */
  devOrigins?: string[];
}

/** `CORTEX_TOKEN` when it is long enough, else 32 random bytes. */
export function makeToken(fixed?: string): string {
  if (fixed && fixed.length >= 16) return fixed;
  return randomBytes(32).toString('base64url');
}

/** constant-time string compare (no early exit on the first different byte) */
export function tokenMatches(given: string | undefined | null, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  // compare equal-length buffers either way, so the length check leaks nothing useful
  const ok = timingSafeEqual(a.length === b.length ? a : b, b);
  return ok && a.length === b.length;
}

/** The cookie name: cookies ignore the port, so two servers on different ports must not share one. */
export const cookieName = (port: number) => `cortex_token_${port}`;

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out.set(k, decodeURIComponent(v));
    } catch {
      out.set(k, v);
    }
  }
  return out;
}

export function authCookie(cfg: SecurityConfig): string {
  return `${cookieName(cfg.port)}=${encodeURIComponent(cfg.token)}; Path=/; HttpOnly; SameSite=Strict`;
}

/** the cookie or the bearer header carries the token */
export function isAuthenticated(req: Pick<IncomingMessage, 'headers'>, cfg: SecurityConfig): boolean {
  const auth = req.headers.authorization;
  if (auth && /^Bearer /i.test(auth) && tokenMatches(auth.slice(7).trim(), cfg.token)) return true;
  return tokenMatches(parseCookies(req.headers.cookie).get(cookieName(cfg.port)), cfg.token);
}

export const allowedHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];

/** `Host` names this server (DNS rebinding: an attacker's name resolving to 127.0.0.1 is refused) */
export function hostAllowed(host: string | undefined, cfg: SecurityConfig): boolean {
  return !!host && allowedHosts(cfg.port).includes(host.toLowerCase());
}

export function allowedOrigins(cfg: SecurityConfig): string[] {
  return [...allowedHosts(cfg.port).map((h) => `http://${h}`), ...(cfg.devOrigins ?? [])];
}

/** no Origin (a top-level navigation, curl), or one of the allowed local origins */
export function originAllowed(origin: string | undefined, cfg: SecurityConfig): boolean {
  if (origin === undefined) return true;
  return allowedOrigins(cfg).includes(origin.toLowerCase().replace(/\/+$/, ''));
}

/** `CORTEX_DEV_ORIGIN=http://127.0.0.1:5173,http://localhost:5173` → normalized origins (bad entries dropped) */
export function parseOrigins(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const s of (raw ?? '').split(',')) {
    try {
      const u = new URL(s.trim());
      if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) out.push(u.origin);
    } catch {
      /* not a URL */
    }
  }
  return out;
}
