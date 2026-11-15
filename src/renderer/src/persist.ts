/**
 * Workspace persistence: `{version, items, links, prefs, camera?}` goes to `native.workspace`
 * (a JSON file in userData; localStorage in the browser), debounced, and is loaded on start
 * through the migration + zod pipeline (`domain/migrations.ts`).
 *
 * - unreadable / corrupt JSON: main already falls back to `workspace.json.bak`
 * - not a workspace (or from a newer app): an empty canvas, a copy of the file is kept as
 *   `workspace.invalid-<time>.json` next to it, and a warning toast is shown
 * - single invalid items / links: dropped with a console warning (and a toast)
 * - an older version: migrated and written back right away (the old file becomes the `.bak`)
 */
import { shallow } from 'zustand/shallow';
import { DEFAULT_PREFS, parseWorkspace, WORKSPACE_VERSION, type Workspace } from './domain';
import { native } from './native';
import { demoWorld, firstRunWorld } from './seed';
import { appStore, getState, prefsOf, replaceWorld, type State } from './store';
import type { UserConfigPatch } from '../../shared/userConfig';

const SAVE_DELAY = 500;

export interface LoadReport {
  /** where it came from */
  source: 'file' | 'migrated' | 'seed';
  /** something the user should know about (shown as a toast once the UI is up) */
  warning?: { title: string; message: string };
  /** settings a v3 workspace still held: they go to config.json once (`startConfigSync`) */
  movedPrefs?: UserConfigPatch;
}
/** Put the first-run world (empty: the canvas shows the welcome panel) into the store. */
function loadFirstRun(prefs?: Workspace['prefs']): void {
  const w = firstRunWorld();
  replaceWorld(w.items, w.links, prefs ?? prefsOf(getState()));
}

/** "Load demo world": the made-up sample world (no filesystem, no network) instead of the current one. */
export function loadDemoWorld(): void {
  const w = demoWorld();
  replaceWorld(w.items, w.links, prefsOf(getState()));
}

/** Load the stored workspace into the store (the first-run world when nothing usable is stored). */
export async function loadWorkspace(): Promise<LoadReport> {
  let raw: unknown;
  try {
    raw = await native.workspace.load();
  } catch (err) {
    console.warn('[workspace] load failed, using the first-run world', err);
    loadFirstRun();
    return { source: 'seed', warning: { title: 'Could not load the workspace', message: 'Starting with an empty canvas instead.' } };
  }
  if (raw == null) {
    loadFirstRun();
    return { source: 'seed' };
  }

  const r = parseWorkspace(raw);
  if (!r.ok) {
    console.warn(`[workspace] invalid workspace file, using the first-run world: ${r.error}`);
    const kept = await keepInvalidCopy(raw);
    loadFirstRun();
    return {
      source: 'seed',
      warning: { title: 'Workspace file could not be read', message: `Starting with an empty canvas instead.${kept ? ` The file was kept as ${kept}.` : ''}` },
    };
  }
  r.warnings.forEach((w) => console.warn(`[workspace] ${w}`));
  const { items, links, prefs } = r.workspace;
  const movedPrefs = r.movedPrefs;
  replaceWorld(items, links, prefs);
  if (r.migrated) saveNow(true);
  const dropped = r.warnings.filter((w) => w.startsWith('dropped')).length;
  return {
    source: r.migrated ? 'migrated' : 'file',
    movedPrefs,
    warning: dropped ? { title: `${dropped} entr${dropped === 1 ? 'y' : 'ies'} of the workspace could not be loaded`, message: 'Details are in the developer console.' } : undefined,
  };
}

/** Copy an unusable file aside so the next save can't destroy it. Returns its file name. */
async function keepInvalidCopy(raw: unknown): Promise<string | null> {
  try {
    const path = await native.workspace.path();
    if (!path.endsWith('.json')) return null;
    const copy = path.replace(/\.json$/, `.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await native.fs.writeText({ path: copy, text: JSON.stringify(raw, null, 2) });
    return copy.split(/[\\/]/).pop() ?? copy;
  } catch {
    return null; // browser fallback has no fs; the .bak in main still holds the previous version
  }
}

/** What goes into the file. */
export function toWorkspace(s: State): Workspace {
  return { version: WORKSPACE_VERSION, items: s.items, links: s.links, prefs: prefsOf(s) };
}

// the user settings (model, notifications, …) are not in here: they live in config.json (`data/config.ts`)
const persisted = (s: State) => [s.items, s.links, s.colorBy, s.filter, s.settings.sidebarWidth] as const;

let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function saveNow(force = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!dirty && !force) return;
  dirty = false;
  native.workspace.save({ data: toWorkspace(getState()) }).catch((err: unknown) => console.warn('[workspace] save failed', err));
}

let started = false;
/** Start saving on every change of the persisted state. Call after `loadWorkspace`. */
export function startAutosave(): void {
  if (started) return;
  started = true;
  appStore.subscribe(
    persisted,
    () => {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(saveNow, SAVE_DELAY);
    },
    { equalityFn: shallow },
  );
  // don't lose the last half second on close / reload
  window.addEventListener('beforeunload', () => {
    if (timer) saveNow();
  });
}

/** Throw away the stored workspace and go back to the first-run world (prefs stay). */
export async function resetToDemo(): Promise<void> {
  loadFirstRun({ ...DEFAULT_PREFS, ...prefsOf(getState()), filter: undefined });
}
