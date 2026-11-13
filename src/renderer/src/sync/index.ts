/**
 * Keeping the canvas in sync with the outside world (desktop only):
 * `live.ts` (push events from main → items + query caches, startup reconciliation) and
 * `refresher.ts` (background polling of git / gh / jira for the ring caches).
 * Pure mappings live in `mapping.ts`.
 */
import { reconcile, startLiveSync } from './live';
import { startRefresher } from './refresher';

export { reconcile, startLiveSync } from './live';
export { refreshDue, startRefresher } from './refresher';

/** Start everything. Call once, after the workspace is loaded. */
export function startSync() {
  startLiveSync();
  void reconcile().finally(() => startRefresher());
}
