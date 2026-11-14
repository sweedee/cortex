import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Content-Security-Policy of the app window, as a <meta> tag. The packaged renderer (file://) gets the
 * strict one: only the app's own scripts, no remote code. Inline styles are needed by Strato,
 * CodeMirror and mermaid; data: / blob: by mermaid and CodeMirror (images, fonts, workers); Strato's
 * fonts come from dt-cdn.net (fonts only, never scripts).
 * Dev additionally allows the Vite dev server (scripts, HMR socket) and react-refresh's inline preamble.
 * <webview> guests (GitHub, Jira, running apps) are separate pages and not affected.
 */
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://dt-cdn.net",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const CSP_DEV = CSP_PROD.replace("script-src 'self'", "script-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*").replace(
  "connect-src 'self' data: blob:",
  "connect-src 'self' data: blob: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*",
);

function csp(): Plugin {
  let dev = false;
  return {
    name: 'cortex-csp',
    configResolved: (c) => void (dev = c.command === 'serve'),
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: dev ? CSP_DEV : CSP_PROD }, injectTo: 'head-prepend' }],
  };
}

/**
 * Layout (electron-vite defaults): src/main → out/main, src/preload → out/preload,
 * src/renderer (index.html + src/) → out/renderer. Static assets stay in ./public.
 */
export default defineConfig({
  main: {
    build: { outDir: 'out/main' },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      // sandboxed preloads must be CommonJS and may only require 'electron'
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    publicDir: resolve('public'),
    // relative asset URLs, so the build also works from file://
    base: './',
    plugins: [react(), csp()],
    build: { outDir: 'out/renderer' },
  },
});
