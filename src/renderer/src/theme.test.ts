import { describe, expect, it, vi } from 'vitest';
import { applyAnimations, parseThemePref, resolveTheme } from './theme';

describe('theme', () => {
  it('resolves a preference against the OS', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme(undefined, false)).toBe('light');
  });

  it('reads unknown stored values as "system"', () => {
    expect(parseThemePref('light')).toBe('light');
    expect(parseThemePref('Dark')).toBe('system');
    expect(parseThemePref(undefined)).toBe('system');
    expect(parseThemePref(3)).toBe('system');
  });

  it('every configured preference resolves, and a bad config value follows the OS', () => {
    for (const [pref, dark, want] of [['dark', false, 'dark'], ['light', true, 'light'], ['system', true, 'dark'], ['bogus', false, 'light']] as const) expect(resolveTheme(parseThemePref(pref), dark)).toBe(want);
  });

  it('animations off sets a class on the document element', () => {
    const doc = { documentElement: { classList: { toggle: vi.fn<() => void>() } } } as unknown as Document;
    applyAnimations(false, doc);
    expect(doc.documentElement.classList.toggle).toHaveBeenCalledWith('no-animations', true);
  });
});
