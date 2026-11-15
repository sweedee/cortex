/**
 * The kind registry: one module per kind (`kinds/<kind>/index.tsx`), and the cached,
 * kind-agnostic derivations the UI uses (`viewsOf`, `ctxOf`, `actionsForItem`).
 *
 * The store knows nothing about kinds; `installKindInfo()` hands it what its filter and layout need
 * (levels, ring tones, search text). `main.tsx` calls it before anything renders; tests that use the
 * filter call it too. Importing this module has no side effects.
 */
import type { Item, ItemOf, Kind, Link, Segment } from '../domain';
import { KINDS, linkedIds } from '../domain';
import { provideKindInfo, useStore, getState, type State } from '../store';
import { agent } from './agent';
import { app } from './app';
import { build } from './build';
import { archiveAction, completeAction, sortActions, unarchiveAction } from './common';
import { deployment } from './deployment';
import { pr } from './pr';
import { project } from './project';
import { record } from './record';
import { testrun } from './testrun';
import { ticket } from './ticket';
import { todo } from './todo';
import type { Action, Badge, KindCtx, KindModule, KindModules } from './types';
import { worktree } from './worktree';

export const MODULES: KindModules = { project, ticket, worktree, record, pr, agent, app, build, deployment, todo, testrun };

/** Kinds in display order (legend, filter, add menu). */
export { KINDS };

/** The module of a kind. */
export function getKind<K extends Kind>(kind: K): KindModule<K> {
  return MODULES[kind] as KindModule<K>;
}
/** The module typed for "some item" (use when you only have the union `Item`). */
const anyKind = (kind: Kind) => MODULES[kind] as unknown as KindModule;

export const kindLabel = (kind: Kind) => MODULES[kind].label;
export const kindIcon = (kind: Kind, size?: number) => MODULES[kind].icon(size);
export const levelOf = (kind: Kind) => MODULES[kind].level;
export const radiusOf = (kind: Kind) => MODULES[kind].radius;

// ---- ctx ---------------------------------------------------------------------------------

export function makeCtx(items: Item[], links: Link[]): KindCtx {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ofKind = <K extends Kind>(list: Item[], kind?: K) => (kind ? list.filter((i) => i.kind === kind) : list) as ItemOf<K>[];
  const ctx: KindCtx = {
    items,
    links,
    get: (id) => byId.get(id),
    getAs: (id, kind) => {
      const it = id ? byId.get(id) : undefined;
      return it?.kind === kind ? (it as ItemOf<typeof kind>) : undefined;
    },
    linked: (id, kind) =>
      ofKind(
        linkedIds(links, id)
          .map((x) => byId.get(x))
          .filter((x): x is Item => !!x),
        kind,
      ),
    inProject: (projectId, kind) => ofKind(
      items.filter((i) => i.projectId === projectId && i.id !== projectId),
      kind,
    ),
    projectOf: (item) => ctx.getAs(item.projectId, 'project'),
    kind: getKind,
  };
  return ctx;
}

let ctxCache: { items: Item[]; links: Link[]; ctx: KindCtx } | null = null;
/** The ctx for a state, cached on (items, links) identity. */
export function ctxOf(s: Pick<State, 'items' | 'links'> = getState()): KindCtx {
  if (!ctxCache || ctxCache.items !== s.items || ctxCache.links !== s.links) ctxCache = { items: s.items, links: s.links, ctx: makeCtx(s.items, s.links) };
  return ctxCache.ctx;
}
export const useCtx = () => useStore(ctxOf);

// ---- per-item derivations ----------------------------------------------------------------

/** Everything the canvas draws for an item, derived from its data. */
export interface ItemView {
  ring: Segment[];
  short?: string;
  badge?: Badge;
  subtitle?: string;
  /** needs the user (pulses) */
  waiting: boolean;
  /** something runs (ring has a running segment): live links */
  running: boolean;
}

export function viewOf(item: Item, ctx: KindCtx): ItemView {
  const m = anyKind(item.kind);
  const ring = m.ring(item, ctx);
  return {
    ring,
    short: m.short?.(item),
    badge: m.badge?.(item),
    subtitle: m.subtitle(item, ctx),
    waiting: !!m.waiting?.(item),
    running: ring.some((s) => s.tone === 'running'),
  };
}

/** Two views draw the same thing (so the old object can be kept and memoized bubbles skip a render). */
export function sameView(a: ItemView, b: ItemView): boolean {
  return (
    a.short === b.short &&
    a.subtitle === b.subtitle &&
    a.waiting === b.waiting &&
    a.running === b.running &&
    a.badge?.label === b.badge?.label &&
    a.badge?.tone === b.badge?.tone &&
    a.ring.length === b.ring.length &&
    a.ring.every((x, i) => x.tone === b.ring[i]?.tone && x.label === b.ring[i]?.label && x.weight === b.ring[i]?.weight)
  );
}

let viewCache: { items: Item[]; links: Link[]; views: Map<string, ItemView> } | null = null;
/**
 * Views of all items, cached on (items, links). Items whose view did not change keep their
 * view object, so a patch to one item re-renders only that item's bubble.
 */
export function viewsOf(s: Pick<State, 'items' | 'links'> = getState()): Map<string, ItemView> {
  if (viewCache && viewCache.items === s.items && viewCache.links === s.links) return viewCache.views;
  const ctx = ctxOf(s);
  const prev = viewCache?.views;
  const views = new Map(
    s.items.map((i) => {
      const v = viewOf(i, ctx);
      const old = prev?.get(i.id);
      return [i.id, old && sameView(old, v) ? old : v];
    }),
  );
  viewCache = { items: s.items, links: s.links, views };
  return views;
}
export const useViews = () => useStore(viewsOf);

export const factsOf = (item: Item, ctx: KindCtx = ctxOf()) => anyKind(item.kind).facts(item, ctx);
export const sidebarOf = (kind: Kind) => anyKind(kind).Sidebar;

// ---- actions -----------------------------------------------------------------------------

/** All actions of one item, primary first. Archived items can only be looked at or restored. */
export function actionsForItem(item: Item, ctx: KindCtx = ctxOf()): Action[] {
  const m = anyKind(item.kind);
  let own = m.actions([item], ctx);
  const primary = m.primaryAction?.(item, ctx);
  if (primary) own = own.map((a) => ({ ...a, primary: a.id === primary }));
  if (item.archived) return [unarchiveAction, ...own.filter((a) => a.type === 'view' || a.type === 'external').map((a) => ({ ...a, primary: false }))];
  const extra: Action[] = [];
  if (m.complete) extra.push(completeAction(m));
  extra.push(archiveAction);
  return sortActions([...own, ...extra]);
}

// ---- the store's view of kinds ------------------------------------------------------------

/** Give the store what it needs to know about kinds (call once at start; idempotent). */
export function installKindInfo() {
  provideKindInfo(KIND_INFO);
}

const KIND_INFO: Parameters<typeof provideKindInfo>[0] = {
  level: levelOf,
  status: (items, links) => {
    const views = viewsOf({ items, links });
    const out = new Map<string, { ring: Segment[]; text: string }>();
    for (const i of items) {
      const v = views.get(i.id)!;
      out.set(i.id, { ring: v.ring, text: `${i.handle} ${i.title} ${v.subtitle ?? ''}` });
    }
    return out;
  },
};
