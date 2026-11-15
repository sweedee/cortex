/** The @-mention popup's matching, kept pure so it can be tested and its index reused across keystrokes. */
import type { Item } from '../domain';

export interface MentionEntry {
  item: Item;
  handle: string;
  title: string;
}

/** Lower-cased handle and title of every item (build once per items change). */
export const mentionIndex = (items: Item[]): MentionEntry[] => items.map((item) => ({ item, handle: item.handle.toLowerCase(), title: item.title.toLowerCase() }));

/**
 * Items matching the @-query: visible ones first, then selected ones, then handles that start
 * with the query. Archived items only when the filter shows them. `hits` = every visible match
 * (highlighted on the canvas), `options` = the first `limit` for the popup.
 */
export function mentionOptions(index: MentionEntry[], query: string, visible: Set<string>, selected: string[], limit: number) {
  const q = query.toLowerCase();
  const sel = new Set(selected);
  const matches = index.filter((e) => (visible.has(e.item.id) || !e.item.archived) && (e.handle.includes(q) || e.title.includes(q)));
  matches.sort(
    (a, b) =>
      Number(visible.has(b.item.id)) - Number(visible.has(a.item.id)) ||
      Number(sel.has(b.item.id)) - Number(sel.has(a.item.id)) ||
      Number(b.handle.startsWith(q)) - Number(a.handle.startsWith(q)),
  );
  return {
    options: matches.slice(0, limit).map((e) => e.item),
    hits: matches.filter((e) => visible.has(e.item.id)).map((e) => e.item.id),
  };
}
