/**
 * Writes layout positions straight to the DOM. The simulation ticks up to 60 times a second
 * for a few seconds after every change; re-rendering React for that would re-run the whole
 * canvas each frame, so bubbles and links register their elements here and are moved with
 * style / attribute writes instead.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { onTick, positionOf } from '../layout';

type Pt = { x?: number | null; y?: number | null } | undefined;

/** CSS transform that puts a bubble of radius `r` centred on (x, y). */
export const bubbleTransform = (x: number, y: number, r: number) => `translate(${x - r}px, ${y - r}px)`;

/** Curved connection between two points, bent a little perpendicular to the line. '' if either is unknown. */
export function linkPath(a: Pt, b: Pt): string {
  if (a?.x == null || a.y == null || b?.x == null || b.y == null) return '';
  const ax = a.x,
    ay = a.y,
    bx = b.x,
    by = b.y;
  const dx = bx - ax,
    dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(len * 0.12, 40);
  const cx = (ax + bx) / 2 - (dy / len) * bend;
  const cy = (ay + by) / 2 + (dx / len) * bend;
  return `M${ax},${ay} Q${cx},${cy} ${bx},${by}`;
}

/** Thread from a point on the chat box's top edge up to a bubble on screen. */
export const threadPath = (ox: number, oy: number, x: number, y: number) => `M${ox},${oy} C${ox},${oy - 120} ${x},${y + 140} ${x},${y}`;

// ---- bubbles ------------------------------------------------------------------------------

const bubbles = new Map<string, { el: HTMLElement; r: number }>();

function place(id: string, el: HTMLElement, r: number) {
  const p = positionOf(id);
  if (p?.x != null && p.y != null) el.style.transform = bubbleTransform(p.x, p.y, r);
}

const placers = new Set<() => void>();

/**
 * Move every registered bubble to its current layout position and redraw what follows them
 * (links, overlays). Runs on every layout tick; the canvas also calls it right after syncing
 * the layout, so new bubbles are in place before the first paint.
 */
export function placeAll() {
  bubbles.forEach(({ el, r }, id) => place(id, el, r));
  placers.forEach((f) => f());
}
onTick(placeAll);

/** Run `fn` (kept fresh across renders) whenever positions are placed. */
export function useOnPlace(fn: () => void) {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    const f = () => latest.current();
    placers.add(f);
    return () => {
      placers.delete(f);
    };
  }, []);
}

/** Ref for a bubble's root element: positioned now and on every layout tick. */
export function useBubblePosition(id: string, r: number) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    bubbles.set(id, { el, r });
    place(id, el, r);
    return () => {
      if (bubbles.get(id)?.el === el) bubbles.delete(id);
    };
  }, [id, r]);
  return ref;
}

// ---- screen-space overlays ------------------------------------------------------------------

export interface Placement {
  x: number;
  y: number;
  /** opens to the other side; changing it re-renders */
  flip?: boolean;
}

/**
 * Keeps a fixed-position overlay (hover card, inline actions) next to moving bubbles.
 * `compute` runs during render (its result is returned for the first paint) and again on each
 * layout tick, where only `left` / `top` of the element are written. If the result appears,
 * disappears or flips, the owning component re-renders instead.
 */
export function useFollow(compute: () => Placement | null) {
  const ref = useRef<HTMLDivElement>(null);
  const at = compute();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const latest = useRef({ compute, at });
  const apply = useCallback(() => {
    const p = latest.current.compute();
    const cur = latest.current.at;
    if (!p || !cur) {
      if (!p !== !cur) bump();
      return;
    }
    if (!!p.flip !== !!cur.flip) return bump();
    const el = ref.current;
    if (el) ((el.style.left = `${p.x}px`), (el.style.top = `${p.y}px`));
  }, []);
  // React only writes left/top when the rendered value changes; ticks may have moved it since
  useLayoutEffect(() => {
    latest.current = { compute, at };
    apply();
  });
  useOnPlace(apply);
  return [ref, at] as const;
}
