import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { cspDev } from './src/server/http/csp.ts';

/** Dev only: the CSP as a `<meta>` tag (in production the server sends it as a header, src/server/http/csp.ts). */
function devCsp(): Plugin {
  return {
    name: 'cortex-dev-csp',
    apply: 'serve',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: cspDev() }, injectTo: 'head-prepend' }],
  };
}

/** The Cortex server the dev proxy forwards /api (HTTP and the events WebSocket) to. */
const backend = `http://127.0.0.1:${process.env['CORTEX_PORT'] || process.env['PORT'] || 4317}`;

/**
 * The renderer: src/renderer (index.html + src/) → out/renderer, served by the Cortex server in
 * production (`npm start`). Static assets stay in ./public. In dev (`npm run dev`) Vite serves the page
 * on 127.0.0.1 (the auth cookie is per host, so it must be the server's host) and proxies /api.
 */
export default defineConfig({
  root: 'src/renderer',
  publicDir: resolve('public'),
  base: '/',
  plugins: [react(), devCsp()],
  build: { outDir: resolve('out/renderer'), emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: backend, changeOrigin: true, ws: true } },
  },
});
