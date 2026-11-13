/**
 * Tiny global store (useSyncExternalStore). Positions live in the simulation (layout.ts),
 * not here, so moving bubbles does not re-render the whole tree.
 */
import { useSyncExternalStore } from 'react';
import type { Item, Kind, Link } from './model';
import { SEED_ITEMS, SEED_LINKS } from './seed';

export type Dialog =
  | { type: 'add'; kind: Kind; at: { x: number; y: number } }
  | { type: 'session'; itemId: string }
  | { type: 'plan'; itemId: string }
  | { type: 'log'; itemId: string }
  | { type: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void }
  | null;

export interface State {
  items: Item[];
  links: Link[];
  selected: string[];
  hovered: string | null;
  /** chat box draft (actions write into it) */
  draft: string;
  /** bumped whenever something wants the chat box focused */
  focusTick: number;
  hiddenKinds: Kind[];
  dialog: Dialog;
  /** item shown in the details sidebar (opened by double-click) */
  inspected: string | null;
}

let state: State = {
  items: SEED_ITEMS,
  links: SEED_LINKS,
  selected: [],
  hovered: null,
  draft: '',
  focusTick: 0,
  hiddenKinds: [],
  dialog: null,
  inspected: null,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export const setState = (fn: (s: State) => State) => {
  state = fn(state);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ---- helpers ------------------------------------------------------------------

export const itemById = (id: string) => state.items.find((i) => i.id === id);

export const select = (ids: string[], additive = false) =>
  setState((s) => {
    const next = additive ? toggleAll(s.selected, ids) : ids;
    // selecting a bubble reads its notification
    const read = new Set(next);
    return { ...s, selected: next, items: s.items.map((i) => (read.has(i.id) && i.notice ? { ...i, notice: undefined } : i)) };
  });

const toggleAll = (cur: string[], ids: string[]) => {
  const set = new Set(cur);
  ids.forEach((id) => (set.has(id) ? set.delete(id) : set.add(id)));
  return [...set];
};

export const setHovered = (id: string | null) => {
  if (state.hovered !== id) setState((s) => ({ ...s, hovered: id }));
};

export const setDraft = (draft: string) => setState((s) => ({ ...s, draft }));
export const focusChat = () => setState((s) => ({ ...s, focusTick: s.focusTick + 1 }));
export const openDialog = (dialog: Dialog) => setState((s) => ({ ...s, dialog }));
export const inspect = (id: string | null) => setState((s) => ({ ...s, inspected: id }));
export const closeDialog = () => setState((s) => ({ ...s, dialog: null }));

export const toggleKind = (kind: Kind) =>
  setState((s) => ({
    ...s,
    hiddenKinds: s.hiddenKinds.includes(kind) ? s.hiddenKinds.filter((k) => k !== kind) : [...s.hiddenKinds, kind],
    selected: s.selected.filter((id) => s.items.find((i) => i.id === id)?.kind !== kind),
    inspected: s.inspected && s.items.find((i) => i.id === s.inspected)?.kind === kind ? null : s.inspected,
  }));

export const patchItem = (id: string, patch: Partial<Item>) =>
  setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

let seq = 0;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

export const addItem = (item: Item, links: Omit<Link, 'id'>[] = []) =>
  setState((s) => ({
    ...s,
    items: [...s.items, item],
    links: [...s.links, ...links.map((l) => ({ ...l, id: newId('l') }))],
  }));

export const removeItems = (ids: string[]) => {
  const gone = new Set(ids);
  setState((s) => ({
    ...s,
    items: s.items.filter((i) => !gone.has(i.id)),
    links: s.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
    selected: s.selected.filter((id) => !gone.has(id)),
    inspected: s.inspected && gone.has(s.inspected) ? null : s.inspected,
  }));
};

export const addLink = (from: string, to: string, label: string) =>
  setState((s) =>
    s.links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))
      ? s
      : { ...s, links: [...s.links, { id: newId('l'), from, to, label }] },
  );

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
    const keep = rest
      .split(/\s+/)
      .filter((w) => w && !mentions.includes(w))
      .join(' ');
    return { ...s, draft: text + (keep ? keep + ' ' : ''), focusTick: s.focusTick + 1 };
  });
}

/** Ids of items that the current draft mentions with @handle. */
export function mentionedIds(draft: string, items: Item[]): string[] {
  const handles = new Set([...draft.matchAll(/@([^\s@]+)/g)].map((m) => m[1].toLowerCase()));
  return items.filter((i) => handles.has(i.handle.toLowerCase())).map((i) => i.id);
}
