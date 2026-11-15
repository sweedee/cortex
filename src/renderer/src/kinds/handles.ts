/** Handles of new items: a slug of the title, made unique among the existing items. */
import { getState } from '../store';

/** "My App!" → "my-app"; `fallback` when nothing is left. */
export const slug = (s: string, fallback: string): string => s.trim().toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

/** `base`, or `base-2`, `base-3`, … when that handle is taken. */
export function uniqueHandle(base: string): string {
  const taken = new Set(getState().items.map((i) => i.handle.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
