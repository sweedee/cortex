/**
 * Workspace persistence: `{version, items, links, prefs, camera?}` goes to `native.workspace`
 * (a JSON file in userData; localStorage in the browser), debounced, and is loaded on start
 * through the migration + zod pipeline (`domain/migrations.ts`).
 *
 * - unreadable / corrupt JSON: main already falls back to `workspace.json.bak`
 * - not a workspace (or from a newer app): demo data, a copy of the file is kept as
 *   `workspace.invalid-<time>.json` next to it, and a warning toast is shown
 * - single invalid items / links: dropped with a console warning (and a toast)
 * - an older version: migrated and written back right away (the old file becomes the `.bak`)
 */
import { shallow } from 'zustand/shallow';
import { DEFAULT_PREFS, parseWorkspace, WORKSPACE_VERSION, type Workspace } from './domain';
import { native } from './native';
import { SEED_ITEMS, SEED_LINKS } from './seed';
import { appStore, getState, prefsOf, replaceWorld, type State } from './store';

const SAVE_DELAY = 500;

export interface LoadReport {
  /** where it came from */
  source: 'file' | 'migrated' | 'seed';
  /** something the user should know about (shown as a toast once the UI is up) */
  warning?: { title: string; message: string };
}

/** Load the stored workspace into the store (keeps the seed when nothing usable is stored). */
export async function loadWorkspace(): Promise<LoadReport> {
  let raw: unknown;
  try {
    raw = await native.workspace.load();
  } catch (err) {
    console.warn('[workspace] load failed, using demo data', err);
    return { source: 'seed', warning: { title: 'Could not load the workspace', message: 'Showing the demo data instead.' } };
  }
  if (raw == null) return { source: 'seed' };

  const r = parseWorkspace(raw);
  if (!r.ok) {
    console.warn(`[workspace] invalid workspace file, using demo data: ${r.error}`);
    const kept = await keepInvalidCopy(raw);
    return {
      source: 'seed',
      warning: { title: 'Workspace file could not be read', message: `Showing the demo data instead.${kept ? ` The file was kept as ${kept}.` : ''}` },
    };
  }
  r.warnings.forEach((w) => console.warn(`[workspace] ${w}`));
  const { items, links, prefs } = r.workspace;
  if (items.length) replaceWorld(items, links, prefs);
  else replaceWorld(SEED_ITEMS, SEED_LINKS, prefs);
  if (r.migrated) saveNow(true);
  const dropped = r.warnings.filter((w) => w.startsWith('dropped')).length;
  return {
    source: r.migrated ? 'migrated' : 'file',
    warning: dropped ? { title: `${dropped} entr${dropped === 1 ? 'y' : 'ies'} of the workspace could not be loaded`, message: 'Details are in the developer console.' } : undefined,
  };
}

/** Copy an unusable file aside so the next save can't destroy it. Returns its file name. */
async function keepInvalidCopy(raw: unknown): Promise<string | null> {
  try {
    const path = await native.workspace.path();
    if (!path.endsWith('.json')) return null;
    const copy = path.replace(/\.json$/, `.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await native.fs.writeText(copy, JSON.stringify(raw, null, 2));
    return copy.split(/[\\/]/).pop() ?? copy;
  } catch {
    return null; // browser fallback has no fs; the .bak in main still holds the previous version
  }
}

/** What goes into the file. */
export function toWorkspace(s: State): Workspace {
  return { version: WORKSPACE_VERSION, items: s.items, links: s.links, prefs: prefsOf(s) };
}

const persisted = (s: State) => [s.items, s.links, s.desktopNotify, s.soundOn, s.colorBy, s.filter, s.settings] as const;

let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function saveNow(force = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!dirty && !force) return;
  dirty = false;
  native.workspace.save(toWorkspace(getState())).catch((err: unknown) => console.warn('[workspace] save failed', err));
}

let started = false;
/** Start saving on every change of the persisted state. Call after `loadWorkspace`. */
export function startAutosave(): void {
  if (started) return;
  started = true;
  appStore.subscribe(persisted, () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(saveNow, SAVE_DELAY);
  }, { equalityFn: shallow });
  // don't lose the last half second on close / reload
  window.addEventListener('beforeunload', () => {
    if (timer) saveNow();
  });
}

/** Throw away the stored workspace and go back to the demo world (prefs stay). */
export function resetToDemo(): void {
  replaceWorld(SEED_ITEMS, SEED_LINKS, { ...DEFAULT_PREFS, ...prefsOf(getState()), filter: undefined });
}
