/**
 * Content-Security-Policy of the app page. The production page gets it as an HTTP header (`app.ts`),
 * the Vite dev server as a `<meta>` tag (`vite.config.ts`). Only the app's own scripts, no remote
 * code, no eval. Inline styles are needed by Strato, CodeMirror and mermaid; data: / blob: by mermaid
 * and CodeMirror (images, fonts, workers); Strato's fonts come from dt-cdn.net (fonts only).
 * `frame-src`: running apps and deployments on localhost are shown in an iframe.
 * Dev additionally allows the Vite dev server (scripts, HMR socket) and react-refresh's inline preamble.
 */
const LOCAL_FRAMES = 'http://localhost:* http://127.0.0.1:* https://localhost:* https://127.0.0.1:*';

export function cspProd(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://dt-cdn.net",
    // 'self' covers the same-origin /api/events WebSocket in current browsers; listed for older ones
    "connect-src 'self' data: blob: ws://127.0.0.1:* ws://localhost:*",
    "worker-src 'self' blob:",
    `frame-src ${LOCAL_FRAMES}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The dev page (a `<meta>` tag: `frame-ancestors` is ignored there, so it is left out). */
export function cspDev(): string {
  return cspProd()
    .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*")
    .replace("connect-src 'self' data: blob: ws://127.0.0.1:* ws://localhost:*", "connect-src 'self' data: blob: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*")
    .replace("; frame-ancestors 'none'", '');
}
