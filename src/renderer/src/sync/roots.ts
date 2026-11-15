/**
 * Tell main which folders Cortex works in (`fs:setRoots`): main refuses `fs:*`, `shell:openPath`,
 * `shell:openInEditor` and the cwd of app / test runs outside them (see ARCHITECTURE.md, Trust model).
 * The roots come from the items: each kind's working folder (`KindModule.cwdOf`: worktrees, app / test /
 * agent folders) and other paths (`KindModule.paths`: project base checkouts and worktrees folders, record files). Re-sent whenever that set changes.
 */
import { native } from '../native';
import type { Item } from '../domain/types';
import { getKind } from '../kinds/registry';
import type { KindModule } from '../kinds/types';
import { getState, subscribe } from '../store';

const isAbs = (p: string | undefined): p is string => !!p && /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(p);

/** the absolute folders / files the items point at, sorted and de-duplicated */
export function rootsOf(items: readonly Item[]): string[] {
  const out = new Set<string>();
  const add = (p: string | undefined) => {
    if (isAbs(p)) out.add(p);
  };
  for (const i of items) {
    const m = getKind(i.kind) as unknown as KindModule;
    add(m.cwdOf?.(i));
    for (const p of m.paths?.(i) ?? []) add(p);
  }
  return [...out].sort();
}

let sent = '';

function push(items: readonly Item[]) {
  const roots = rootsOf(items);
  const key = roots.join('\n');
  if (key === sent) return;
  sent = key;
  void native.fs
    .setRoots({ roots })
    .then((refused) => {
      if (refused.length) console.warn('[roots] refused by main:', refused);
    })
    .catch((e: unknown) => console.warn('[roots] fs:setRoots', e));
}

let started = false;

/** Send the roots now and on every change. Call before anything reads files (record discovery). */
export function startRootSync() {
  if (started) return;
  started = true;
  push(getState().items);
  subscribe((s, prev) => {
    if (s.items !== prev.items) push(s.items);
  });
}
