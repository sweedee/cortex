/**
 * Facts about the running server: production or development, where the app's files are, its version.
 *
 * Production = the bundled server (`npm run build` → `out/server/index.js`, which defines
 * `__CORTEX_BUILT__`) or `NODE_ENV=production`. It replaces Electron's `app.isPackaged`: dev / test
 * overrides are stripped (`devEnv.ts`), `exec:run` refuses, Jira never falls back to the mock.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

declare const __CORTEX_BUILT__: boolean | undefined;

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (typeof __CORTEX_BUILT__ !== 'undefined' && __CORTEX_BUILT__) || env['NODE_ENV'] === 'production';
}

/** The package root (where package.json, scripts/ and out/ live): the nearest package.json above `from`. */
export function findAppRoot(from: string = import.meta.dirname): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) return process.cwd();
  }
}

/** `version` from the package.json in `root`. */
export function appVersion(root: string): string {
  try {
    const v = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
