/**
 * Minimal workspace persistence: the store's `items` + `links` go to `native.workspace`
 * (a JSON file in userData; localStorage in the browser), debounced, and are loaded on
 * start. Deliberately small and replaceable: Phase 0b redoes this with zod + versioning.
 */
import type { Item, Link } from './model';
import { native } from './native';
import { SEED_ITEMS, SEED_LINKS } from './seed';
import { getState, replaceWorld, subscribe } from './store';

const SAVE_DELAY = 500;

interface StoredWorkspace {
  version: 0;
  items: Item[];
  links: Link[];
}

const isStored = (d: unknown): d is StoredWorkspace =>
  !!d && typeof d === 'object' && Array.isArray((d as StoredWorkspace).items) && Array.isArray((d as StoredWorkspace).links);

/** Load the stored workspace into the store (keeps the seed when nothing usable is stored). */
export async function loadWorkspace(): Promise<void> {
  try {
    const data = await native.workspace.load();
    if (isStored(data) && data.items.length) replaceWorld(data.items, data.links);
  } catch (err) {
    console.warn('[workspace] load failed, using demo data', err);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let saved: { items: Item[]; links: Link[] } | null = null;

function saveNow() {
  clearTimeout(timer);
  timer = undefined;
  const { items, links } = getState();
  if (saved && saved.items === items && saved.links === links) return;
  saved = { items, links };
  const data: StoredWorkspace = { version: 0, items, links };
  native.workspace.save(data).catch((err: unknown) => console.warn('[workspace] save failed', err));
}

/** Start saving on every change of items / links. Call after `loadWorkspace`. */
export function startAutosave(): void {
  const { items, links } = getState();
  saved = { items, links };
  subscribe(() => {
    const s = getState();
    if (saved && s.items === saved.items && s.links === saved.links) return;
    clearTimeout(timer);
    timer = setTimeout(saveNow, SAVE_DELAY);
  });
  // don't lose the last half second on close / reload
  window.addEventListener('beforeunload', () => {
    if (timer) saveNow();
  });
}

/** Throw away the stored workspace and go back to the demo world. */
export function resetToDemo(): void {
  replaceWorld(SEED_ITEMS, SEED_LINKS);
}
