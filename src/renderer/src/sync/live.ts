/**
 * Live sync: main's push events → the canvas items and the query caches, for every kind with a
 * `KindModule.live` (agent: `claude:state` / `claude:event`; app: `app:state` / `app:output`;
 * test run: `test:state` / `test:output`). The handlers live in the kinds (`kinds/<kind>/live.ts`);
 * this file starts them and runs the startup reconciliation.
 *
 * `reconcile()` runs once at start: running items that main does not know (the app was
 * restarted) are set to stopped / idle; known ones take main's state.
 */
import type { Item, Kind } from '../domain';
import { getKind, KINDS } from '../kinds/registry';
import type { LiveSync } from '../kinds/types';
import { isDesktop } from '../native';
import { getState } from '../store';

const liveOf = (kind: Kind) => getKind(kind).live as LiveSync<Kind> | undefined;
const LIVE_KINDS = () => KINDS.filter((k) => liveOf(k));

let started = false;
/** Subscribe to main's events. Call once after the workspace is loaded. */
export function startLiveSync(): () => void {
  if (started || !isDesktop) return () => {};
  started = true;
  const offs = LIVE_KINDS().map((k) => liveOf(k)!.start());
  return () => {
    offs.forEach((off) => off());
    started = false;
  };
}

// ---- startup reconciliation ---------------------------------------------------------------

/** What main runs now, per live kind (sessions for agents, processes for apps / test runs). */
export type RunningLists = Partial<Record<Kind, unknown>>;

/**
 * Bring items that say they run in line with main: known sessions / processes take main's
 * state (without notices), unknown ones become idle / stopped. Only items that were really
 * started (agent `localId`, app / test run `procId`) are touched; demo items stay as they are.
 * Nothing changes when one of the lists cannot be read.
 */
export async function reconcile(lists?: RunningLists) {
  if (!lists && !isDesktop) return;
  const kinds = LIVE_KINDS();
  const l =
    lists ??
    (await Promise.all(kinds.map((k) => liveOf(k)!.list()))
      .then((r): RunningLists => Object.fromEntries(kinds.map((k, i) => [k, r[i]])))
      .catch((e: unknown) => {
        console.warn('[sync] reconcile: could not list sessions / processes', e);
        return null;
      }));
  if (!l) return;
  for (const item of getState().items as Item[]) {
    const live = liveOf(item.kind);
    if (live && l[item.kind] !== undefined) live.reconcile(item, l[item.kind]);
  }
}
