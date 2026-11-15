import { app } from 'electron';

const hooks: (() => void)[] = [];
let installed = false;
let ran = false;

function runAll(): void {
  if (ran) return;
  ran = true;
  for (const h of hooks) {
    try {
      h();
    } catch {
      /* quitting: nothing left to report to */
    }
  }
}

/**
 * Run `fn` once when the app goes away (Electron's `will-quit`, or the process `exit` as a fallback for
 * paths that skip it). One pair of listeners for all hooks, and each hook runs at most once.
 */
export function onShutdown(fn: () => void): void {
  hooks.push(fn);
  if (installed) return;
  installed = true;
  app.on('will-quit', runAll);
  process.on('exit', runAll);
}
