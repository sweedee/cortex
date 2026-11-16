import { defineConfig } from 'vitest/config';

/** Two projects: server (+ shared) in node, renderer logic in node too (no DOM needed yet). */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'server', environment: 'node', include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'] } },
      {
        test: {
          name: 'renderer',
          environment: 'node',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          // Strato ships ESM that imports .css: let vite transform it instead of node loading it
          server: { deps: { inline: [/@dynatrace\/strato-/] } },
        },
      },
    ],
  },
});
