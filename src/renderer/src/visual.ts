/** Group colours: the one colour system of the UI (bubbles, chips, threads). */
import type { ColorBy, Item, Link } from './domain';
import { rootsOf } from './domain';
import { levelOf } from './kinds/registry';
import { useStore, type State } from './store';

export { TONE_CHIP, TONE_COLOR, TONE_TOAST } from './tones';

/** Group colours, muted enough to sit on the dark canvas without shouting. */
const GROUP_PALETTE = ['#4aa8ff', '#c27ad0', '#7fc24a', '#e0a33c', '#2bb5c4', '#e8697a', '#9a8cff', '#c9c94a'];

/** Colour of items without a group (colouring off, or no project/ticket above them). */
export const NEUTRAL_ACCENT = '#8a90a8';

/**
 * Colours per item from the project/ticket roots it rolls up to. Items that belong to
 * several roots get several colours; items with no root (or colouring off) get none.
 * Items without links still take their own project's colour (`projectId`).
 */
export function groupColors(items: Item[], links: Link[], by: ColorBy): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (by === 'none') return out;
  const roots = items.filter((i) => i.kind === by);
  const color = new Map(roots.map((r, i) => [r.id, GROUP_PALETTE[i % GROUP_PALETTE.length]]));
  const order = new Map(roots.map((r, i) => [r.id, i]));
  rootsOf(items, links, by, levelOf).forEach((rs, id) => {
    // palette order, so a two-colour bubble always splits the same way
    out.set(id, [...rs].sort((a, b) => order.get(a)! - order.get(b)!).map((r) => color.get(r)!));
  });
  if (by === 'project') for (const i of items) if (!out.has(i.id) && i.projectId && color.has(i.projectId)) out.set(i.id, [color.get(i.projectId)!]);
  return out;
}

let colorCache: { items: Item[]; links: Link[]; by: ColorBy; map: Map<string, string[]> } | null = null;
const colorsOf = (s: State) => {
  if (!colorCache || colorCache.items !== s.items || colorCache.links !== s.links || colorCache.by !== s.colorBy)
    colorCache = { items: s.items, links: s.links, by: s.colorBy, map: groupColors(s.items, s.links, s.colorBy) };
  return colorCache.map;
};
/** The group colours of every item, the one colour system used everywhere in the UI. */
export const useItemColors = () => useStore(colorsOf);
/** Main accent of one item (first group colour or neutral gray). */
export const accentOf = (colors: Map<string, string[]>, id: string) => colors.get(id)?.[0] ?? NEUTRAL_ACCENT;

/** Hard-edged slices of the given colours along a line (for borders and strips), no blending. */
export function stripes(colors: string[], angle = 90): string {
  if (colors.length === 1) return colors[0] ?? '';
  const step = 100 / colors.length;
  return `linear-gradient(${angle}deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

/** Disc fill for one or more group colours: flat slices with hard edges, no blending. */
export function groupFill(colors: string[] | undefined): string | undefined {
  if (!colors?.length) return undefined;
  const tint = (c: string) => `color-mix(in srgb, ${c} 30%, var(--surface-raised))`;
  if (colors.length === 1) return tint(colors[0] ?? '');
  const step = 360 / colors.length;
  const stops = colors.map((c, i) => `${tint(c)} ${i * step}deg ${(i + 1) * step}deg`).join(', ');
  return `conic-gradient(${stops})`;
}
