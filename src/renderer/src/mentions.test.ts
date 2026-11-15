import { describe, expect, it } from 'vitest';
import { SEED_ITEMS } from './testing/fakeWorld';
import { draftMentions, mentionedIds, mentionRe } from './store';

const [a, b] = SEED_ITEMS;

describe('mentionRe', () => {
  it('matches the handle as a whole token, case-insensitively', () => {
    expect('see @CTX-1 now'.replace(mentionRe('ctx-1'), '$1')).toBe('see  now');
    expect('see @CTX-12 now'.replace(mentionRe('ctx-1'), '$1')).toBe('see @CTX-12 now');
    expect('@a.b x'.replace(mentionRe('a.b', true), '$1')).toBe('x');
  });

  it('is cached per handle and trailing-space flag', () => {
    expect(mentionRe('X-1')).toBe(mentionRe('x-1'));
    expect(mentionRe('x-1', true)).not.toBe(mentionRe('x-1'));
  });
});

describe('draftMentions', () => {
  it('keeps the same array while the mentioned ids stay the same', () => {
    const first = draftMentions({ draft: `hi @${a.handle}`, items: SEED_ITEMS });
    expect(first).toEqual([a.id]);
    const typed = draftMentions({ draft: `hi @${a.handle} and some more text`, items: SEED_ITEMS });
    expect(typed).toBe(first);
    const more = draftMentions({ draft: `hi @${a.handle} @${b.handle}`, items: SEED_ITEMS });
    expect(more).toEqual([a.id, b.id]);
    expect(more).not.toBe(first);
  });

  it('agrees with mentionedIds', () => {
    const draft = `@${b.handle} x @${a.handle} @nobody @${b.handle}`;
    expect(draftMentions({ draft, items: SEED_ITEMS })).toEqual(mentionedIds(draft, SEED_ITEMS));
    expect(mentionedIds('no mentions', SEED_ITEMS)).toEqual([]);
  });
});
