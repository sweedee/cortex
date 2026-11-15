import { beforeEach, describe, expect, it } from 'vitest';
import { installKindInfo } from './kinds/registry';
import { DEFAULT_PREFS } from './domain';
import { SEED_ITEMS, SEED_LINKS } from './testing/fakeWorld';
import { EMPTY_FILTER, getState, notify, removeItems, replaceWorld, restoreRemoved, setSynced, setSyncError } from './store';
import { must } from './testing/must';

// the filter needs the kinds' levels, rings and search text
installKindInfo();

beforeEach(() => {
  replaceWorld(SEED_ITEMS, SEED_LINKS, { ...DEFAULT_PREFS, filter: EMPTY_FILTER });
});

describe('removeItems / restoreRemoved', () => {
  it('restores items, links, positions and notices exactly', () => {
    const linked = must(SEED_LINKS[0]);
    const ids = [linked.from, must(SEED_ITEMS[SEED_ITEMS.length - 1]).id];
    notify(linked.from, { text: 'hello', tone: 'warning' });
    const before = { items: getState().items, links: getState().links };
    const snap = removeItems(ids);
    expect(getState().items.some((i) => ids.includes(i.id))).toBe(false);
    expect(getState().links.some((l) => l.id === linked.id)).toBe(false);
    restoreRemoved(snap);
    expect(getState().items).toEqual(before.items);
    expect(getState().links).toEqual(before.links);
    expect(getState().items.find((i) => i.id === linked.from)?.notice?.text).toBe('hello');
  });

  it('restoring twice does not duplicate', () => {
    const snap = removeItems([must(SEED_ITEMS[0]).id]);
    restoreRemoved(snap);
    restoreRemoved(snap);
    expect(getState().items).toHaveLength(SEED_ITEMS.length);
  });
});

describe('sync status', () => {
  it('counts attempts, keeps since, and clears on success', () => {
    expect(setSyncError('x', 'boom')).toBe(1);
    const since = getState().sync.x?.error?.since;
    expect(setSyncError('x', 'boom')).toBe(2);
    expect(getState().sync.x?.error?.since).toBe(since);
    setSynced('x', 5);
    expect(getState().sync.x).toEqual({ lastSyncedAt: 5 });
  });
});
