import { describe, expect, it } from 'vitest';
import { demoWorld } from '../seed';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import { LinkSchema } from './schemas';
import { isLinkLabel, linkFits } from './links';
import type { Item, Link } from './types';

const check = (items: Item[], links: Link[], strict: boolean) => {
  expect(links.length).toBeGreaterThan(0);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of links) {
    const from = byId.get(l.from);
    const to = byId.get(l.to);
    expect(from && to, `${l.id}: both ends exist`).toBeTruthy();
    if (!strict && !isLinkLabel(l.label)) continue;
    expect(linkFits(l.label, from!.kind, to!.kind), `${l.label}: ${from!.kind} → ${to!.kind}`).toBe(true);
  }
};

describe('link types', () => {
  it('the first-run demo world only uses known labels between the documented kinds', () => {
    const w = demoWorld('/home/me', 1);
    check(w.items, w.links, true);
  });

  it('the fake world uses known labels between the documented kinds (plus some free-form ones, like old files)', () => {
    check(SEED_ITEMS, SEED_LINKS, false);
  });

  it('a stored link with a retired label still parses', () => {
    expect(LinkSchema.safeParse({ id: 'l1', from: 'a', to: 'b', label: 'blocks' }).success).toBe(true);
    expect(isLinkLabel('blocks')).toBe(false);
    expect(linkFits('blocks', 'ticket', 'ticket')).toBe(false);
  });
});
