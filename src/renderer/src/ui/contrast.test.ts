import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from './contrast';
import { metricVars } from './metrics';

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8').replace(/\r\n/g, '\n');

/** `--name: #hex` declarations of the first block that starts with `selector {`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

describe('contrastRatio', () => {
  it('follows WCAG', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio('#61667e', '#07080f')).toBeLessThan(4.5); // the old --ink-faint
    expect(parseHex('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(() => parseHex('#12345678')).toThrow('not an opaque hex colour');
  });
});

describe('theme tokens in index.css', () => {
  const dark = tokens(':root');
  const light = { ...dark, ...tokens(":root[data-theme='light']") };
  const surfaces = ['--canvas-bg', '--surface', '--surface-raised'];
  const themes: [string, Record<string, string>][] = [
    ['dark', dark],
    ['light', light],
  ];

  it.each(themes)('%s: faint text reads at 4.5:1 or more on every surface', (_, t) => {
    for (const s of surfaces) expect(contrastRatio(t['--ink-faint'], t[s]), `--ink-faint on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)('%s: status tones stand out from the canvas (3:1, for graphics)', (_, t) => {
    for (const tone of ['--tone-success', '--tone-critical', '--tone-running', '--tone-primary', '--tone-pending'])
      expect(contrastRatio(t[tone], t['--canvas-bg']), tone).toBeGreaterThanOrEqual(3);
  });

  it('component rules use tokens: raw colours only in the token blocks', () => {
    const rules = css.slice(css.indexOf('\nbody {'));
    const raw = rules.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    // the mask in .chatbox.has-context uses #000 as an alpha mask, not a colour
    expect(raw.filter((r) => r !== '#000')).toEqual([]);
  });

  it('every layout size the stylesheet uses is published from ui/metrics.ts', () => {
    const published = new Set(Object.keys(metricVars()));
    const used = [...css.matchAll(/var\((--(?:chat-space|top-space|hover-card-[\w-]+|actions-[\w-]+))\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const v of used) expect(published.has(v), v).toBe(true);
  });

  it('z-index values come from the --z-* scale (small local ones aside)', () => {
    const z = [...css.matchAll(/z-index:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const v of z) expect(v.startsWith('var(--z-') || Number(v) <= 2, v).toBe(true);
  });
});
