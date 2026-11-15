import { describe, expect, it } from 'vitest';
import { keyLabel, matchShortcut, SHORTCUTS, shortcutHint, shortcutsIn } from './shortcuts';

type Mods = Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>>;
const key = (k: string, mods: Mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('matchShortcut', () => {
  it('matches the canvas keys', () => {
    expect(matchShortcut(key('/'), 'canvas')).toBe('chat');
    expect(matchShortcut(key('k', { ctrlKey: true }), 'canvas')).toBe('chat');
    expect(matchShortcut(key('K', { metaKey: true }), 'canvas')).toBe('chat');
    expect(matchShortcut(key('f'), 'canvas')).toBe('fit');
    expect(matchShortcut(key('F'), 'canvas')).toBe('fit');
    expect(matchShortcut(key('a', { ctrlKey: true }), 'canvas')).toBe('selectAll');
    expect(matchShortcut(key('Delete'), 'canvas')).toBe('remove');
    expect(matchShortcut(key('Backspace'), 'canvas')).toBe('remove');
    expect(matchShortcut(key('Enter'), 'canvas')).toBe('primary');
    expect(matchShortcut(key('Escape'), 'canvas')).toBe('escape');
    expect(matchShortcut(key('?'), 'canvas')).toBe('help');
  });

  it('needs the modifier exactly when the binding has one', () => {
    expect(matchShortcut(key('k'), 'canvas')).toBeNull();
    expect(matchShortcut(key('a'), 'canvas')).toBeNull();
    expect(matchShortcut(key('f', { ctrlKey: true }), 'canvas')).toBeNull();
    expect(matchShortcut(key('/', { altKey: true }), 'canvas')).toBeNull();
  });

  it('keeps the bubble keys separate', () => {
    expect(matchShortcut(key('ArrowLeft'), 'bubble')).toBe('move');
    expect(matchShortcut(key('Enter'), 'bubble')).toBe('open');
    expect(matchShortcut(key(' '), 'bubble')).toBe('toggle');
    expect(matchShortcut(key('ArrowLeft'), 'canvas')).toBeNull();
    expect(matchShortcut(key('f'), 'bubble')).toBeNull();
  });
});

describe('the shortcuts table', () => {
  it('binds every key once per scope', () => {
    for (const scope of ['canvas', 'bubble'] as const) {
      const keys = shortcutsIn(scope).flatMap((s) => s.keys.map((b) => `${b.mod ? 'mod+' : ''}${b.key.toLowerCase()}`));
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it('writes keys for people', () => {
    expect(keyLabel({ key: 'k', mod: true })).toBe('Ctrl+K');
    expect(keyLabel({ key: 'k', mod: true }, true)).toBe('⌘K');
    expect(keyLabel({ key: ' ' })).toBe('Space');
    expect(keyLabel({ key: 'Escape' })).toBe('Esc');
    expect(keyLabel({ key: 'ArrowUp' })).toBe('↑');
    expect(shortcutHint('chat')).toBe('/ / Ctrl+K');
    expect(shortcutHint('fit')).toBe('F');
  });
});
