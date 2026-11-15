import { describe, expect, it } from 'vitest';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import { sameView, viewsOf, type ItemView } from './registry';
import { must } from '../testing/must';

const base: ItemView = { ring: [{ tone: 'success', label: 'ok' }], short: 'x', badge: { label: 'b', tone: 'neutral' }, subtitle: 's', waiting: false, running: false };

describe('sameView', () => {
  it('compares what a bubble draws', () => {
    expect(sameView(base, { ...base, ring: [{ tone: 'success', label: 'ok' }], badge: { label: 'b', tone: 'neutral' } })).toBe(true);
    expect(sameView(base, { ...base, ring: [{ tone: 'critical', label: 'ok' }] })).toBe(false);
    expect(sameView(base, { ...base, ring: [] })).toBe(false);
    expect(sameView(base, { ...base, badge: undefined })).toBe(false);
    expect(sameView(base, { ...base, waiting: true })).toBe(false);
    expect(sameView(base, { ...base, subtitle: 't' })).toBe(false);
  });
});

describe('viewsOf', () => {
  it('keeps the view objects of items that did not change', () => {
    const before = viewsOf({ items: SEED_ITEMS, links: SEED_LINKS });
    const first = must(SEED_ITEMS[0]);
    const rest = SEED_ITEMS.slice(1);
    const after = viewsOf({ items: [{ ...first, title: first.title + '!' }, ...rest], links: SEED_LINKS });
    expect(after).not.toBe(before);
    for (const it of rest) expect(after.get(it.id), it.id).toBe(before.get(it.id));
  });
});
