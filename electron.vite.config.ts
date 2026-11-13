import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

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
    plugins: [react()],
    build: { outDir: 'out/renderer' },
  },
});
