/** Pure helpers over items + links (no React, no store). */
import type { Item, Kind, Link } from './types';

/** Position in the hierarchy of a kind (0 = top). The kind registry provides it. */
export type LevelOf = (kind: Kind) => number;

/** Ids of the items linked to `id` (either direction). */
export function linkedIds(links: Link[], id: string): string[] {
  const out: string[] = [];
  for (const l of links) {
    if (l.from === id) out.push(l.to);
    else if (l.to === id) out.push(l.from);
  }
  return out;
}

/**
 * For every item, the roots of the given kind it rolls up to: walk links "upwards"
 * (towards lower levels) and stop at the first item of that kind on each path.
 */
export function rootsOf(items: Item[], links: Link[], kind: Kind, levelOf: LevelOf): Map<string, string[]> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const up = new Map<string, string[]>();
  for (const l of links) {
    const a = byId.get(l.from),
      b = byId.get(l.to);
    if (!a || !b || levelOf(a.kind) === levelOf(b.kind)) continue;
    const [lo, hi] = levelOf(a.kind) > levelOf(b.kind) ? [a, b] : [b, a];
    up.set(lo.id, [...(up.get(lo.id) ?? []), hi.id]);
  }
  const out = new Map<string, string[]>();
  for (const it of items) {
    const found = new Set<string>();
    const seen = new Set<string>();
    const stack = [it.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (byId.get(id)?.kind === kind) {
        found.add(id);
        continue; // stop at the root, don't climb past it
      }
      stack.push(...(up.get(id) ?? []));
    }
    if (found.size) out.set(it.id, [...found]);
  }
  return out;
}

/** An absolute path a process can run in (`C:\…`, `C:/…`, `/…`, `\server\…`); demo paths like `~/code/x` are not. */
export const isRealPath = (p: string | undefined): p is string => !!p && /^([A-Za-z]:[\\/]|\/|\\\\)/.test(p);

/** A GitHub `owner/name` Cortex can reach (demo repos `unknown/…` are not). */
/** The repo of the demo world (`seed.ts`); its items are static and never synced. */
export const DEMO_REPO = 'unknown/demo';

export const isRealRepo = (r: string | undefined) => !!r && /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith('unknown/');
