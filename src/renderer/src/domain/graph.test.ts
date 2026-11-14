import { describe, expect, it } from 'vitest';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import { linkedIds, rootsOf } from './graph';
import type { Item, Kind, Link } from './types';

const LEVEL: Record<Kind, number> = { project: 0, ticket: 1, deployment: 1, worktree: 2, record: 2, pr: 3, agent: 3, app: 3, todo: 3, build: 4, testrun: 4 };
const levelOf = (k: Kind) => LEVEL[k];
const item = (id: string, kind: Kind) => ({ id, kind, handle: id, title: id }) as Item;
const link = (from: string, to: string): Link => ({ id: `${from}-${to}`, from, to, label: '' });

describe('rootsOf', () => {
  const items = [item('p1', 'project'), item('p2', 'project'), item('t1', 'ticket'), item('w1', 'worktree'), item('a1', 'agent'), item('lonely', 'build')];

  it('climbs links towards lower levels and stops at the first root of the kind', () => {
    const links = [link('p1', 't1'), link('t1', 'w1'), link('a1', 'w1')];
    const roots = rootsOf(items, links, 'project', levelOf);
    expect(roots.get('w1')).toEqual(['p1']);
    expect(roots.get('a1')).toEqual(['p1']);
    expect(roots.get('p1')).toEqual(['p1']);
    expect(roots.has('lonely')).toBe(false);
  });

  it('collects several roots and ignores same-level links and dangling ids', () => {
    const links = [link('p1', 't1'), link('p2', 't1'), link('p1', 'p2'), link('t1', 'ghost')];
    expect(rootsOf(items, links, 'project', levelOf).get('t1')?.sort()).toEqual(['p1', 'p2']);
  });

  it('does not climb past a ticket root', () => {
    const links = [link('p1', 't1'), link('t1', 'w1')];
    const roots = rootsOf(items, links, 'ticket', levelOf);
    expect(roots.get('w1')).toEqual(['t1']);
    expect(roots.has('p1')).toBe(false);
  });

  it('gives every linked seed item below a project a project root', () => {
    const roots = rootsOf(SEED_ITEMS, SEED_LINKS, 'project', levelOf);
    const linked = new Set(SEED_LINKS.flatMap((l) => [l.from, l.to]));
    for (const i of SEED_ITEMS.filter((i) => linked.has(i.id) && i.kind !== 'project')) expect(roots.get(i.id), i.id).toBeTruthy();
  });
});

describe('linkedIds', () => {
  it('follows links in both directions', () => {
    expect(linkedIds([link('a', 'b'), link('c', 'a'), link('x', 'y')], 'a').sort()).toEqual(['b', 'c']);
  });
});
