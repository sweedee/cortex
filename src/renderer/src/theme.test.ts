import { describe, expect, it } from 'vitest';
import { parseThemePref, resolveTheme } from './theme';

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
});
