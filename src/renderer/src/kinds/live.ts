/**
 * Helpers for kinds backed by a process / session in main (`KindModule.live`: agent, app, test run).
 * `sync/live.ts` starts them and runs the startup reconciliation; the handlers live in the kinds.
 */
import { queryClient } from '../data/queryClient';
import type { DataOf, ItemOf, Kind } from '../domain';
import { getState, notify, patchData } from '../store';
import { changes, tailOf, type Mapped, type NoticeSpec } from '../sync/mapping';

/** Max size of a log cache (app / test output). */
export const LOG_MAX = 256 * 1024;

/** Current items of a kind that match. */
export const itemsWhere = <K extends Kind>(kind: K, match: (i: ItemOf<K>) => boolean): ItemOf<K>[] => getState().items.filter((i): i is ItemOf<K> => i.kind === kind && match(i as ItemOf<K>));

/** Apply a mapped state: patch the data if it changed, raise the notice (unless quiet). */
export function applyMapped<K extends Kind>(item: ItemOf<K>, m: Mapped<DataOf<K>>, opts: { notices: boolean }) {
  if (changes(item.data as object, m.patch)) patchData<K>(item, m.patch);
  if (opts.notices && m.notice) notify(item.id, m.notice as NoticeSpec);
}

/** Append output to a log cache, if it is loaded (kept at `LOG_MAX`). */
export const appendLog = (key: readonly unknown[], chunk: string) => queryClient.setQueryData<string>(key, (old) => (old === undefined ? old : tailOf(old + chunk, LOG_MAX)));

/** Patch for an item main does not know any more (stopped / idle); null = nothing to do. */
export function markStale(item: { id: string }, patch: object | null) {
  if (patch) patchData(item.id, patch);
}
