/**
 * Force layout (d3-force). Positions live here, outside React state; components
 * subscribe with useLayoutTick() and read `positionOf(id)`.
 */
import { useEffect, useReducer } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Item, Kind, Link } from './model';
import { KIND_RADIUS } from './model';

export interface Node extends SimulationNodeDatum {
  id: string;
  r: number;
  kind: Kind;
  cluster?: string;
}
type SimLink = SimulationLinkDatum<Node> & { id: string };

/** Where each project's cluster gravitates to. New clusters are placed on a ring. */
const clusterCenters = new Map<string, { x: number; y: number }>([
  ['p-ingest', { x: -420, y: -20 }],
  ['p-console', { x: 430, y: -40 }],
  ['p-alert', { x: 10, y: 380 }],
]);
const clusterCenter = (c?: string) => {
  if (!c) return { x: 0, y: 0 };
  let p = clusterCenters.get(c);
  if (!p) {
    const a = clusterCenters.size * 2.1;
    p = { x: Math.cos(a) * 700, y: Math.sin(a) * 520 };
    clusterCenters.set(c, p);
  }
  return p;
};

const nodes = new Map<string, Node>();
const seeded = new Map<string, { x: number; y: number }>();

const sim = forceSimulation<Node>([])
  .alphaDecay(0.025)
  .velocityDecay(0.38)
  .force(
    'charge',
    forceManyBody<Node>().strength((n) => (n.kind === 'project' ? -700 : -180)),
  )
  .force('collide', forceCollide<Node>((n) => n.r + (n.kind === 'project' ? 34 : 48)).strength(0.85))
  .force(
    'link',
    forceLink<Node, SimLink>([])
      .id((n) => n.id)
      .distance((l) => (l.source as Node).r + (l.target as Node).r + 80)
      .strength(0.45),
  )
  .force('x', forceX<Node>((n) => clusterCenter(n.cluster).x).strength((n) => (n.kind === 'project' ? 0.2 : 0.05)))
  .force('y', forceY<Node>((n) => clusterCenter(n.cluster).y).strength((n) => (n.kind === 'project' ? 0.2 : 0.05)));

const tickListeners = new Set<() => void>();
let frame = 0;
sim.on('tick', () => {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    tickListeners.forEach((l) => l());
  });
});
export const onTick = (l: () => void) => {
  tickListeners.add(l);
  return () => tickListeners.delete(l);
};

/** Re-render on every (rAF-throttled) simulation tick. */
export function useLayoutTick() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = onTick(bump);
    return () => {
      off();
    };
  }, []);
}

export const positionOf = (id: string) => nodes.get(id);

/** Keep the simulation in sync with the store's items and links. */
export function syncLayout(items: Item[], links: Link[]) {
  let changed = false;
  const alive = new Set(items.map((i) => i.id));
  for (const id of [...nodes.keys()]) if (!alive.has(id)) (nodes.delete(id), (changed = true));
  for (const it of items) {
    if (nodes.has(it.id)) continue;
    changed = true;
    const s = seeded.get(it.id);
    const linked = links.find((l) => l.from === it.id || l.to === it.id);
    const anchor = s ?? (linked && nodes.get(linked.from === it.id ? linked.to : linked.from)) ?? clusterCenter(it.cluster);
    const jitter = s ? 0 : 160;
    nodes.set(it.id, {
      id: it.id,
      kind: it.kind,
      r: KIND_RADIUS[it.kind],
      cluster: it.cluster,
      x: (anchor.x ?? 0) + (Math.random() - 0.5) * jitter,
      y: (anchor.y ?? 0) + (Math.random() - 0.5) * jitter,
    });
  }
  const simLinks: SimLink[] = links
    .filter((l) => nodes.has(l.from) && nodes.has(l.to))
    .map((l) => ({ id: l.id, source: l.from, target: l.to }));
  sim.nodes([...nodes.values()]);
  sim.force<ReturnType<typeof forceLink<Node, SimLink>>>('link')!.links(simLinks);
  if (changed || simLinks.length !== lastLinkCount) sim.alpha(Math.max(sim.alpha(), 0.6)).restart();
  lastLinkCount = simLinks.length;
}
let lastLinkCount = 0;

// ---- dragging ----------------------------------------------------------------------

export function dragStart(ids: string[]) {
  ids.forEach((id) => {
    const n = nodes.get(id);
    if (n) ((n.fx = n.x), (n.fy = n.y));
  });
  sim.alphaTarget(0.2).restart();
}
export function dragBy(ids: string[], dx: number, dy: number) {
  ids.forEach((id) => {
    const n = nodes.get(id);
    if (n) ((n.fx = (n.fx ?? n.x ?? 0) + dx), (n.fy = (n.fy ?? n.y ?? 0) + dy));
  });
}
/** Dropped bubbles stay where you put them (until "Auto-arrange"). */
export function dragEnd() {
  sim.alphaTarget(0);
}
export function unpinAll() {
  nodes.forEach((n) => ((n.fx = null), (n.fy = null)));
  sim.alpha(0.9).restart();
}
export const isPinned = (id: string) => nodes.get(id)?.fx != null;

// ---- placement helpers for new bubbles --------------------------------------------

/** Registered by the canvas: the world point at the centre of the screen etc. */
export const camera: {
  center: () => { x: number; y: number };
  focus: (ids: string[]) => void;
  fit: () => void;
  zoom: (factor: number) => void;
} = { center: () => ({ x: 0, y: 0 }), focus: () => {}, fit: () => {}, zoom: () => {} };

export const place = {
  near(id: string) {
    const n = nodes.get(id);
    const a = Math.random() * Math.PI * 2;
    return n ? { x: (n.x ?? 0) + Math.cos(a) * 130, y: (n.y ?? 0) + Math.sin(a) * 130 } : camera.center();
  },
  center: () => camera.center(),
  /** next new bubble with this id starts at this world point */
  seed(id: string, at: { x: number; y: number }) {
    seeded.set(id, at);
    const n = nodes.get(id);
    if (n) ((n.x = at.x), (n.y = at.y));
  },
};

/** Bounding box of the given (or all) nodes. */
export function bounds(ids?: string[]) {
  const list = ids ? ids.map((id) => nodes.get(id)).filter((n): n is Node => !!n) : [...nodes.values()];
  if (list.length === 0) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const n of list) {
    x0 = Math.min(x0, (n.x ?? 0) - n.r);
    y0 = Math.min(y0, (n.y ?? 0) - n.r);
    x1 = Math.max(x1, (n.x ?? 0) + n.r);
    y1 = Math.max(y1, (n.y ?? 0) + n.r + 30);
  }
  return { x0, y0, x1, y1 };
}

/** Run the simulation forward synchronously so the first paint is already settled. */
export function warmUp(ticks = 220) {
  sim.stop();
  sim.tick(ticks);
  sim.alpha(0.05).restart();
}
