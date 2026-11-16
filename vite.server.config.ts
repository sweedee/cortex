import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The server: src/server/index.ts → out/server/index.js (one ESM bundle; dependencies stay in
 * node_modules). `__CORTEX_BUILT__` marks the bundle as production (src/server/lib/runtime.ts).
 */
export default defineConfig({
  publicDir: false,
  define: { __CORTEX_BUILT__: 'true' },
  build: {
    ssr: resolve('src/server/index.ts'),
    outDir: resolve('out/server'),
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    rollupOptions: { output: { format: 'esm', entryFileNames: 'index.js' } },
  },
});
