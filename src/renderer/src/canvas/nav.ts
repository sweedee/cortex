/**
 * Keyboard and screen-reader access to the canvas: which bubble the arrow keys move to, what a
 * bubble announces, and the small glyph that says its status without relying on colour. Pure.
 */
import type { Item, Segment, Tone } from '../domain';

export type Direction = 'left' | 'right' | 'up' | 'down';
export interface NavPoint {
  id: string;
  x: number;
  y: number;
}

export const ARROW_DIRECTION: Record<string, Direction | undefined> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * The bubble an arrow key moves to: the closest one in that direction, preferring bubbles near
 * the axis (off-axis distance counts double). Bubbles inside a 60° cone around the axis win; if
 * there are none, anything on that side will do. null when nothing lies that way.
 */
export function nearestInDirection(from: { x: number; y: number }, dir: Direction, points: NavPoint[]): string | null {
  let best: { id: string; score: number; inCone: boolean } | null = null;
  for (const p of points) {
    const dx = p.x - from.x,
      dy = p.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
    if (along <= 0.5) continue; // behind, level with, or the bubble itself
    const inCone = across <= along * Math.tan(Math.PI / 3);
    const score = along + across * 2;
    if (!best || (inCone && !best.inCone) || (inCone === best.inCone && score < best.score)) best = { id: p.id, score, inCone };
  }
  return best?.id ?? null;
}

/** "Checks failing, Review requested" from the ring (labels deduped), or "no status". */
export function statusText(ring: Segment[]): string {
  const labels = [...new Set(ring.map((s) => s.label.trim()).filter(Boolean))];
  return labels.length ? labels.join(', ') : 'no status';
}

/** What a bubble announces: `{handle}, {title}, {status}` plus whatever else is marked on it. */
export function bubbleLabel(item: Pick<Item, 'handle' | 'title' | 'archived' | 'notice'>, ring: Segment[], extra: { waiting?: boolean; syncError?: string } = {}): string {
  const parts = [item.handle, item.title, statusText(ring)];
  if (extra.waiting) parts.push('waiting for you');
  if (item.notice && !item.notice.read && !item.archived) parts.push(`new: ${item.notice.text}`);
  if (extra.syncError) parts.push(extra.syncError);
  if (item.archived) parts.push('archived');
  return parts.filter(Boolean).join(', ');
}

/**
 * The status glyph drawn on a bubble next to its coloured ring: the worst of failing / needs
 * attention, or a check when everything is green. Other states (running animates, idle) get none.
 */
export function statusGlyph(ring: Segment[]): { glyph: string; tone: Tone } | null {
  if (ring.some((s) => s.tone === 'critical')) return { glyph: '✕', tone: 'critical' };
  if (ring.some((s) => s.tone === 'warning')) return { glyph: '!', tone: 'warning' };
  if (ring.length && ring.every((s) => s.tone === 'success')) return { glyph: '✓', tone: 'success' };
  return null;
}

/**
 * The bubble that takes the canvas's single tab stop: the one last focused (if still shown),
 * else the first selected one shown, else the first shown.
 */
export function tabStopOf(focused: string | null, selected: string[], shown: string[]): string | null {
  const vis = new Set(shown);
  if (focused && vis.has(focused)) return focused;
  return selected.find((id) => vis.has(id)) ?? shown[0] ?? null;
}
