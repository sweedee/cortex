/**
 * Keeps one slice of the store in localStorage: loads it (or the seed) into the store
 * and writes it back whenever it changes. Used for Cortex's own data that has no
 * service behind it yet (todos, toolbox, projects).
 */
import type { CortexState } from '../model/types';
import { getState, setState, subscribe } from './store';

export function persistSlice<K extends keyof CortexState>(key: K, storageKey: string, seed: CortexState[K]) {
  let value = seed;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) value = JSON.parse(raw) as CortexState[K];
  } catch {
    // storage unavailable or corrupt — fall back to the seed
  }
  setState((s) => ({ ...s, [key]: value }));
  let last = getState()[key];
  subscribe(() => {
    const current = getState()[key];
    if (current === last) return;
    last = current;
    try {
      localStorage.setItem(storageKey, JSON.stringify(current));
    } catch {
      // ignore: the data still works for this session
    }
  });
}

/** Short unique id for locally created things. */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
