import { describe, expect, it } from 'vitest';
import { bubbleLabel, nearestInDirection, statusGlyph, statusText, tabStopOf } from './nav';

const pts = [
  { id: 'right-near', x: 100, y: 10 },
  { id: 'right-far', x: 300, y: 0 },
  { id: 'right-diag', x: 60, y: 90 },
  { id: 'up', x: 0, y: -120 },
  { id: 'left', x: -200, y: 30 },
];

describe('nearestInDirection', () => {
  it('picks the closest bubble near the axis', () => {
    expect(nearestInDirection({ x: 0, y: 0 }, 'right', pts)).toBe('right-near');
    expect(nearestInDirection({ x: 0, y: 0 }, 'up', pts)).toBe('up');
    expect(nearestInDirection({ x: 0, y: 0 }, 'left', pts)).toBe('left');
  });

  it('prefers a bubble in the cone over a closer one far off the axis', () => {
    // (40, 90) is nearer than (200, 0) but 66° off the axis
    expect(
      nearestInDirection({ x: 0, y: 0 }, 'right', [
        { id: 'diag', x: 40, y: 90 },
        { id: 'axis', x: 200, y: 0 },
      ]),
    ).toBe('axis');
  });

  it('falls back to anything on that side when the cone is empty', () => {
    expect(nearestInDirection({ x: 0, y: 0 }, 'down', [{ id: 'steep', x: 300, y: 20 }])).toBe('steep');
  });

  it('returns null when nothing lies that way, and skips the bubble itself', () => {
    expect(
      nearestInDirection({ x: 0, y: 0 }, 'down', [
        { id: 'self', x: 0, y: 0 },
        { id: 'up', x: 0, y: -50 },
      ]),
    ).toBeNull();
    expect(nearestInDirection({ x: 0, y: 0 }, 'left', [])).toBeNull();
  });
});

describe('tabStopOf', () => {
  it('keeps the focused bubble, else the first shown selection, else the first shown bubble', () => {
    expect(tabStopOf('b', ['c'], ['a', 'b', 'c'])).toBe('b');
    expect(tabStopOf(null, ['x', 'c'], ['a', 'b', 'c'])).toBe('c');
    expect(tabStopOf('gone', [], ['a', 'b'])).toBe('a');
    expect(tabStopOf(null, [], [])).toBeNull();
  });
});

describe('bubble status for assistive tech', () => {
  const ring = [
    { tone: 'critical' as const, label: 'Checks failing' },
    { tone: 'pending' as const, label: 'Review requested' },
    { tone: 'critical' as const, label: 'Checks failing' },
  ];

  it('labels as handle, title, status', () => {
    expect(statusText(ring)).toBe('Checks failing, Review requested');
    expect(statusText([])).toBe('no status');
    expect(bubbleLabel({ handle: 'pr-12', title: 'Fix login' }, ring)).toBe('pr-12, Fix login, Checks failing, Review requested');
  });

  it('adds what else is marked on the bubble', () => {
    const notice = { text: 'Done', tone: 'success' as const, at: 0 };
    expect(bubbleLabel({ handle: 'a1', title: 'Agent', archived: true, notice }, [], { waiting: true, syncError: 'Sync failing' })).toBe(
      'a1, Agent, no status, waiting for you, Sync failing, archived',
    );
    expect(bubbleLabel({ handle: 'a1', title: 'Agent', notice }, [])).toBe('a1, Agent, no status, new: Done');
  });

  it('draws a glyph for failing, attention and all-green, nothing otherwise', () => {
    expect(statusGlyph(ring)).toEqual({ glyph: '✕', tone: 'critical' });
    expect(
      statusGlyph([
        { tone: 'warning', label: 'x' },
        { tone: 'success', label: 'y' },
      ])?.tone,
    ).toBe('warning');
    expect(statusGlyph([{ tone: 'success', label: 'y' }])?.glyph).toBe('✓');
    expect(
      statusGlyph([
        { tone: 'success', label: 'y' },
        { tone: 'running', label: 'r' },
      ]),
    ).toBeNull();
    expect(statusGlyph([])).toBeNull();
  });
});
