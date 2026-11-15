import { describe, expect, it } from 'vitest';
import { demoWorld } from '../seed';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import { LinkSchema } from './schemas';
import { isLinkLabel, linkFits } from './links';
import type { Item, Link } from './types';

/** Links that do not fit their documented kinds (`strict`: unknown labels count too). */
const misfits = (items: Item[], links: Link[], strict: boolean) => {
  const byId = new Map(items.map((i) => [i.id, i]));
  return links.flatMap((l) => {
    const from = byId.get(l.from)?.kind;
    const to = byId.get(l.to)?.kind;
    if (!from || !to) return [`${l.id}: missing end`];
    if (!strict && !isLinkLabel(l.label)) return [];
    return linkFits(l.label, from, to) ? [] : [`${l.label}: ${from} → ${to}`];
  });
};

describe('link types', () => {
  it('the first-run demo world only uses known labels between the documented kinds', () => {
    const w = demoWorld(1);
    expect(w.links.length).toBeGreaterThan(0);
    expect(misfits(w.items, w.links, true)).toEqual([]);
  });

  it('the fake world uses known labels between the documented kinds (plus some free-form ones, like old files)', () => {
    expect(misfits(SEED_ITEMS, SEED_LINKS, false)).toEqual([]);
  });

  it('a stored link with a retired label still parses', () => {
    expect(LinkSchema.safeParse({ id: 'l1', from: 'a', to: 'b', label: 'blocks' }).success).toBe(true);
    expect(isLinkLabel('blocks')).toBe(false);
    expect(linkFits('blocks', 'ticket', 'ticket')).toBe(false);
  });
});
