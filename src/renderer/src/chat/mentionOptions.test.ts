import { describe, expect, it } from 'vitest';
import type { Item } from '../domain';
import { mentionIndex, mentionOptions } from './mentionOptions';

const it_ = (id: string, handle: string, title: string, archived = false) => ({ id, handle, title, ...(archived && { archived }) }) as unknown as Item;
const items = [it_('a', 'CTX-1', 'Ingest pipeline'), it_('b', 'pr-12', 'Fix ctx parsing'), it_('c', 'wt-ctx', 'Worktree'), it_('d', 'CTX-9', 'Old', true)];
const index = mentionIndex(items);

describe('mentionOptions', () => {
  it('matches handle or title, case-insensitively (handle prefix first, else list order)', () => {
    const { options } = mentionOptions(index, 'ctx', new Set(['a', 'b', 'c']), [], 7);
    expect(options.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts visible, then selected, then handle-prefix matches first', () => {
    const { options, hits } = mentionOptions(index, 'ctx', new Set(['b', 'c']), ['c'], 7);
    // a is not visible (filtered out), but not archived either: still offered, last
    expect(options.map((o) => o.id)).toEqual(['c', 'b', 'a']);
    expect(hits).toEqual(['c', 'b']);
  });

  it('offers archived items only when they are visible', () => {
    expect(mentionOptions(index, 'ctx-9', new Set(), [], 7).options).toEqual([]);
    expect(mentionOptions(index, 'ctx-9', new Set(['d']), [], 7).options.map((o) => o.id)).toEqual(['d']);
  });

  it('limits the options but not the hits', () => {
    const r = mentionOptions(index, '', new Set(['a', 'b', 'c']), [], 2);
    expect(r.options).toHaveLength(2);
    expect(r.hits).toHaveLength(3);
  });
});
