/**
 * Global UI + world state (zustand). Positions live in the simulation (layout.ts), not
 * here, so moving bubbles does not re-render the whole tree.
 *
 * The exported functions are the API; components read with `useStore(selector)`.
 * The store knows nothing about individual kinds: what it needs from them (ring tones and
 * search text for the filter, hierarchy levels) is provided by the kind registry through
 * `provideKindInfo` (kinds/registry.ts), so kind modules can import the store without an
 * import cycle.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ColorBy, DataOf, Filter, Item, ItemOf, Kind, Link, NewItem, Notice, Prefs, Segment } from './domain';
import { DEFAULT_PREFS, rootsOf, STATUS_GROUPS } from './domain';
import { notifyPermitted } from './native';
import { SEED_ITEMS, SEED_LINKS } from './seed';

export type { ColorBy, Filter } from './domain';

export type Dialog =
  | { type: 'add'; kind: Kind; at: { x: number; y: number } }
  | { type: 'session'; itemId: string }
  | { type: 'record'; itemId: string }
  | { type: 'log'; itemId: string }
  | { type: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void }
  | null;

export const EMPTY_FILTER: Filter = { hiddenKinds: [], status: [], projects: [], query: '', unreadOnly: false, showArchived: false };

/** Matches of the @-query being typed in the chat box, highlighted on the canvas. */
export interface Search {
  ids: string[];
  /** the option under the keyboard cursor in the popup */
  active: string | null;
}

export interface State {
  items: Item[];
  links: Link[];
  selected: string[];
  hovered: string | null;
  /** chat box draft (actions write into it) */
  draft: string;
  /**
   * @mentions the selection put into the draft. They follow the selection (replaced on
   * the next click) until the user types something, then they stay.
   */
  autoIds: string[];
  /** bumped whenever something wants the chat box focused */
  focusTick: number;
  filter: Filter;
  search: Search | null;
  dialog: Dialog;
  /** item shown in the details sidebar (opened by double-click) */
  inspected: string | null;
  /** what bubbles are coloured by: nothing (gray), their project(s) or their ticket(s) */
  colorBy: ColorBy;
  /** send OS notifications for new notices (needs browser permission) */
  desktopNotify: boolean;
  /** play a chime for new notices */
  soundOn: boolean;
}

const initial = (): State => ({
  items: SEED_ITEMS,
  links: SEED_LINKS,
  selected: [],
  hovered: null,
  draft: '',
  autoIds: [],
  focusTick: 0,
  filter: EMPTY_FILTER,
  search: null,
  dialog: null,
  inspected: null,
  colorBy: DEFAULT_PREFS.colorBy,
  desktopNotify: false,
  soundOn: DEFAULT_PREFS.soundOn,
});

/** The zustand store itself (for `subscribe(selector, listener)` and tests). */
export const appStore = create<State>()(subscribeWithSelector(initial));

export const getState = () => appStore.getState();
/** Replace the state with `fn(state)` (returning the same object is a no-op). */
export const setState = (fn: (s: State) => State) => {
  const cur = appStore.getState();
  const next = fn(cur);
  if (next !== cur) appStore.setState(next, true);
};
/** Listen to every state change. */
export const subscribe = (l: (s: State, prev: State) => void) => appStore.subscribe(l);
/** Read the store in a component. The selector must return stable values (cache derived ones). */
export function useStore<T>(sel: (s: State) => T): T {
  return appStore(sel);
}

// ---- kind info (provided by the registry) ----------------------------------------------------

export interface KindInfo {
  level: (kind: Kind) => number;
  /** ring and search text of every item; cache on (items, links) identity */
  status: (items: Item[], links: Link[]) => Map<string, { ring: Segment[]; text: string }>;
}
let kindInfo: KindInfo = {
  level: () => 0,
  status: (items) => new Map(items.map((i) => [i.id, { ring: [], text: `${i.handle} ${i.title}` }])),
};
export function provideKindInfo(info: KindInfo) {
  kindInfo = info;
  visCache = null;
}

// ---- visibility (filter) ------------------------------------------------------------------

let visCache: { items: Item[]; links: Link[]; filter: Filter; ids: Set<string> } | null = null;

/** Ids of the items the filter lets through. Cached, so it is safe to use as a store selector. */
export function visibleSet(s: State = getState()): Set<string> {
  if (visCache && visCache.items === s.items && visCache.links === s.links && visCache.filter === s.filter) return visCache.ids;
  const f = s.filter;
  const q = f.query.trim().toLowerCase();
  const groups = STATUS_GROUPS.filter((g) => f.status.includes(g.id));
  const roots = f.projects.length ? rootsOf(s.items, s.links, 'project', kindInfo.level) : null;
  const info = groups.length || q ? kindInfo.status(s.items, s.links) : null;
  const ids = new Set<string>();
  for (const i of s.items) {
    if (i.archived && !f.showArchived) continue;
    if (f.hiddenKinds.includes(i.kind)) continue;
    if (groups.length && !groups.some((g) => g.test(info!.get(i.id)?.ring ?? []))) continue;
    if (roots && !(f.projects.includes(i.id) || i.projectId && f.projects.includes(i.projectId) || roots.get(i.id)?.some((r) => f.projects.includes(r)))) continue;
    if (f.unreadOnly && !(i.notice && !i.notice.read)) continue;
    if (q && !(info!.get(i.id)?.text ?? `${i.handle} ${i.title}`).toLowerCase().includes(q)) continue;
    ids.add(i.id);
  }
  visCache = { items: s.items, links: s.links, filter: f, ids };
  return ids;
}
export const useVisible = () => useStore(visibleSet);

export const activeFilterCount = (f: Filter) =>
  f.hiddenKinds.length + f.status.length + f.projects.length + (f.query.trim() ? 1 : 0) + (f.unreadOnly ? 1 : 0) + (f.showArchived ? 1 : 0);

/** Drop selection / inspection of items that are no longer visible. */
const prune = (s: State): State => {
  const vis = visibleSet(s);
  const selected = s.selected.filter((id) => vis.has(id));
  const next = selected.length === s.selected.length ? s : withSelection(s, selected, true);
  return next.inspected && !vis.has(next.inspected) ? { ...next, inspected: null } : next;
};

export const setFilter = (patch: Partial<Filter>) => setState((s) => prune({ ...s, filter: { ...s.filter, ...patch } }));
export const resetFilter = () => setState((s) => prune({ ...s, filter: EMPTY_FILTER }));
export const toggleKind = (kind: Kind) => {
  const h = getState().filter.hiddenKinds;
  setFilter({ hiddenKinds: h.includes(kind) ? h.filter((k) => k !== kind) : [...h, kind] });
};

// ---- helpers ------------------------------------------------------------------

export const itemById = (id: string) => getState().items.find((i) => i.id === id);

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** at most this many bubbles get auto-mentioned; a big marquee or Ctrl+A should not flood the draft */
const AUTO_MAX = 6;

/** The draft with the previous auto-mentions swapped for the new selection. */
function autoMention(s: State, ids: string[]): Pick<State, 'draft' | 'autoIds'> {
  const handle = (id: string) => s.items.find((i) => i.id === id)?.handle;
  let draft = s.draft;
  for (const id of s.autoIds) {
    const h = handle(id);
    if (h) draft = draft.replace(new RegExp(`(^|\\s)@${esc(h)}(?=\\s|$) ?`, 'i'), '$1');
  }
  const present = new Set(mentionedIds(draft, s.items));
  const add = ids.length <= AUTO_MAX ? ids.filter((id) => !present.has(id) && handle(id)) : [];
  const tokens = add.map((id) => `@${handle(id)}`).join(' ');
  const rest = draft.trim();
  // into an empty draft at the start; after what the user wrote otherwise
  if (!tokens) draft = rest ? draft.replace(/\s+$/, ' ') : '';
  else if (!rest) draft = tokens + ' ';
  else draft = draft.replace(/\s+$/, '') + ' ' + tokens + ' ';
  return { draft, autoIds: add };
}

function withSelection(s: State, next: string[], mention: boolean): State {
  // selecting a bubble reads its notification
  const read = new Set(next);
  const items = s.items.some((i) => read.has(i.id) && i.notice && !i.notice.read)
    ? s.items.map((i) => (read.has(i.id) && i.notice && !i.notice.read ? { ...i, notice: { ...i.notice, read: true } } : i))
    : s.items;
  const base = { ...s, selected: next, items };
  return mention ? { ...base, ...autoMention(base, next) } : { ...base, autoIds: [] };
}

export const select = (ids: string[], additive = false, opts: { mention?: boolean } = {}) =>
  setState((s) => withSelection(s, additive ? toggleAll(s.selected, ids) : ids, opts.mention ?? true));

const toggleAll = (cur: string[], ids: string[]) => {
  const set = new Set(cur);
  ids.forEach((id) => (set.has(id) ? set.delete(id) : set.add(id)));
  return [...set];
};

export const setHovered = (id: string | null) => {
  if (getState().hovered !== id) setState((s) => ({ ...s, hovered: id }));
};

/** Draft edits. `user` edits that add own text turn the auto-mentions into regular ones. */
export const setDraft = (draft: string, user = false) =>
  setState((s) => {
    if (!draft) return { ...s, draft, autoIds: [] };
    if (!user || !s.autoIds.length) return { ...s, draft };
    let rest = draft;
    for (const id of s.autoIds) {
      const h = s.items.find((i) => i.id === id)?.handle;
      if (h) rest = rest.replace(new RegExp(`(^|\\s)@${esc(h)}(?=\\s|$)`, 'i'), '$1');
    }
    // a "#action" search being typed is not own text either
    rest = rest.replace(/(^|\s)[#!][\w-]*/g, '$1');
    return { ...s, draft, autoIds: rest.trim() ? [] : s.autoIds };
  });
export const setSearch = (search: Search | null) => {
  const cur = getState().search;
  if (cur === search) return;
  if (cur && search && cur.active === search.active && cur.ids.length === search.ids.length && cur.ids.every((id, i) => id === search.ids[i])) return;
  setState((s) => ({ ...s, search }));
};
export const focusChat = () => setState((s) => ({ ...s, focusTick: s.focusTick + 1 }));
export const openDialog = (dialog: Dialog) => setState((s) => ({ ...s, dialog }));
export const setColorBy = (colorBy: ColorBy) => setState((s) => ({ ...s, colorBy }));
export const inspect = (id: string | null) => setState((s) => ({ ...s, inspected: id }));
export const closeDialog = () => setState((s) => ({ ...s, dialog: null }));

// ---- items ----------------------------------------------------------------------------

/** Merge common fields into an item (not `data`; use `patchData` for that). Bumps `updatedAt`. */
export const patchItem = (id: string, patch: Partial<Omit<Item, 'id' | 'kind' | 'data'>>) =>
  setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? ({ ...i, ...patch, updatedAt: Date.now() } as Item) : i)) }));

/** Merge into an item's typed `data` (and optionally common fields). */
export function patchData<K extends Kind>(item: ItemOf<K> | string, patch: Partial<DataOf<K>>, common: Partial<Omit<Item, 'id' | 'kind' | 'data'>> = {}) {
  const id = typeof item === 'string' ? item : item.id;
  setState((s) => ({
    ...s,
    items: s.items.map((i) => (i.id === id ? ({ ...i, ...common, data: { ...i.data, ...patch }, updatedAt: Date.now() } as Item) : i)),
  }));
}

/** Put whole items back (undo); items that no longer exist are ignored. */
export const restoreItems = (snapshot: Item[]) => {
  const byId = new Map(snapshot.map((i) => [i.id, i]));
  setState((s) => prune({ ...s, items: s.items.map((i) => byId.get(i.id) ?? i) }));
};

let seq = 0;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

/** Stamp id and timestamps on a new item. */
export function makeItem(n: NewItem): Item {
  const now = Date.now();
  return { ...n, id: n.id || newId(n.kind), createdAt: now, updatedAt: now } as Item;
}

export const addItem = (item: Item | NewItem, links: Omit<Link, 'id'>[] = []) => {
  const it = 'createdAt' in item ? (item as Item) : makeItem(item);
  setState((s) => ({
    ...s,
    items: [...s.items, it],
    links: [...s.links, ...links.map((l) => ({ ...l, id: newId('l') }))],
  }));
  return it;
};

export const removeItems = (ids: string[]) => {
  const gone = new Set(ids);
  setState((s) =>
    withSelection(
      {
        ...s,
        items: s.items.filter((i) => !gone.has(i.id)),
        links: s.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
        inspected: s.inspected && gone.has(s.inspected) ? null : s.inspected,
      },
      s.selected.filter((id) => !gone.has(id)),
      false,
    ),
  );
};

/** Archive (or restore) items. Archived items leave the canvas unless the filter shows them. */
export const setArchived = (ids: string[], archived: boolean) => {
  const set = new Set(ids);
  const now = Date.now();
  setState((s) =>
    prune({
      ...s,
      items: s.items.map((i) =>
        set.has(i.id) ? ({ ...i, archived: archived || undefined, notice: archived && i.notice ? { ...i.notice, read: true } : i.notice, updatedAt: now } as Item) : i,
      ),
    }),
  );
};

export const addLink = (from: string, to: string, label: string) =>
  setState((s) =>
    s.links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))
      ? s
      : { ...s, links: [...s.links, { id: newId('l'), from, to, label }] },
  );

/** Remember where the user dropped bubbles (persisted; the layout pins them there). */
export function setPinned(pos: Map<string, { x: number; y: number }>) {
  if (!pos.size) return;
  setState((s) => ({ ...s, items: s.items.map((i) => (pos.has(i.id) ? ({ ...i, pos: pos.get(i.id) } as Item) : i)) }));
}
export const clearPinned = () => setState((s) => (s.items.some((i) => i.pos) ? { ...s, items: s.items.map((i) => (i.pos ? ({ ...i, pos: undefined } as Item) : i)) } : s));

// ---- notifications ----------------------------------------------------------------------

export const markRead = (ids?: string[]) =>
  setState((s) => ({
    ...s,
    items: s.items.map((i) => (i.notice && !i.notice.read && (!ids || ids.includes(i.id)) ? { ...i, notice: { ...i.notice, read: true } } : i)),
  }));
export const clearNotices = () => setState((s) => prune({ ...s, items: s.items.map((i) => (i.notice ? { ...i, notice: undefined } : i)) }));

type NoticeListener = (item: Item, notice: Notice) => void;
const noticeListeners = new Set<NoticeListener>();
export const onNotice = (l: NoticeListener) => {
  noticeListeners.add(l);
  return () => noticeListeners.delete(l);
};
/** Attach a fresh (unread) notice to an item; desktop notifications and chimes listen to this. */
export function notify(id: string, notice: Pick<Notice, 'text' | 'tone'> & { at?: number }) {
  patchItem(id, { notice: { at: Date.now(), ...notice, read: false } });
  const item = itemById(id);
  if (item) noticeListeners.forEach((l) => l(item, item.notice!));
}

// ---- prefs ------------------------------------------------------------------------------

export const setDesktopNotify = (on: boolean) => setState((s) => ({ ...s, desktopNotify: on }));
export const setSoundOn = (on: boolean) => setState((s) => ({ ...s, soundOn: on }));

/** The persisted prefs of a state (a new object each call: don't use it as a `useStore` selector). */
export const prefsOf = (s: State): Prefs => ({ desktopNotify: s.desktopNotify, soundOn: s.soundOn, colorBy: s.colorBy, filter: s.filter });

/** Replace the whole world (workspace load / reset); drops selection and other pointers into the old one. */
export const replaceWorld = (items: Item[], links: Link[], prefs?: Prefs) =>
  setState((s) => ({
    ...s,
    items,
    links,
    selected: [],
    autoIds: [],
    hovered: null,
    inspected: null,
    search: null,
    dialog: null,
    ...(prefs && {
      // desktop notifications also need the OS / browser permission
      desktopNotify: prefs.desktopNotify && notifyPermitted(),
      soundOn: prefs.soundOn,
      colorBy: prefs.colorBy,
      filter: prefs.filter ?? EMPTY_FILTER,
    }),
  }));

// ---- chat box ---------------------------------------------------------------------------

/** Insert a skill (and @mentions of the given items) into the chat box, without sending. */
export function insertSkill(skill: string | null, ids: string[]) {
  const mentions = ids
    .map((id) => itemById(id)?.handle)
    .filter(Boolean)
    .map((h) => `@${h}`);
  const text = [skill ? `/${skill}` : '', ...mentions].filter(Boolean).join(' ') + ' ';
  setState((s) => {
    // replace a leading skill if the draft already starts with one, keep the rest of what the user typed
    const rest = s.draft.replace(/^\/[\w-]+\s*/, '');
    const lower = mentions.map((m) => m.toLowerCase());
    const keep = rest
      .split(/\s+/)
      .filter((w) => w && !lower.includes(w.toLowerCase()))
      .join(' ');
    return { ...s, draft: text + (keep ? keep + ' ' : ''), autoIds: [], focusTick: s.focusTick + 1 };
  });
}

/** Ids of items that the current draft mentions with @handle, in the order they appear. */
export function mentionedIds(draft: string, items: Item[]): string[] {
  const handles = [...new Set([...draft.matchAll(/@([^\s@]+)/g)].map((m) => m[1].toLowerCase()))];
  const byHandle = new Map(items.map((i) => [i.handle.toLowerCase(), i.id]));
  return handles.map((h) => byHandle.get(h)).filter((id): id is string => !!id);
}
