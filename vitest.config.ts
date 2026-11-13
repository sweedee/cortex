import { defineConfig } from 'vitest/config';

/** Two projects: main (+ shared) in node, renderer logic in node too (no DOM needed yet). */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'main', environment: 'node', include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'] } },
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
