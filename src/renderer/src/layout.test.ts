import { describe, expect, it } from 'vitest';
import { reheatAlpha } from './layout';

describe('reheatAlpha', () => {
  it('does not restart when nothing changed', () => {
    expect(reheatAlpha(0, 0, 0)).toBe(0);
  });

  it('nudges gently for a bubble or two, or a few links', () => {
    expect(reheatAlpha(1, 0, 1)).toBe(0.3);
    expect(reheatAlpha(0, 2, -3)).toBe(0.3);
    expect(reheatAlpha(0, 0, 2)).toBe(0.3);
  });

  it('re-arranges for bigger changes', () => {
    expect(reheatAlpha(3, 0, 0)).toBe(0.6);
    expect(reheatAlpha(0, 0, 4)).toBe(0.6);
    expect(reheatAlpha(20, 20, 30)).toBe(0.6);
  });
});
