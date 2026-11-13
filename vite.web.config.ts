import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Renderer only, in a plain browser (no Electron): `native.ts` uses its browser fallback. */
export default defineConfig({
  root: 'src/renderer',
  publicDir: resolve('public'),
  plugins: [react()],
});
