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
import type { Item, Link } from './domain';
import { clearPinned, setPinned } from './store';

export interface Node extends SimulationNodeDatum {
  id: string;
  r: number;
  /** hierarchy level of the kind (0 = project) */
  level: number;
  /** level-0 items (projects) anchor their cluster */
  anchor: boolean;
  cluster?: string;
}

/** Size and hierarchy of an item; the canvas passes the kind registry's numbers. */
export type Metrics = (item: Item) => { r: number; level: number };
type SimLink = SimulationLinkDatum<Node> & { id: string };

/** Where each project's cluster gravitates to. New clusters are placed on a ring. */
const clusterCenters = new Map<string, { x: number; y: number }>([
  ['p-ingest', { x: -380, y: -30 }],
  ['p-console', { x: 390, y: -50 }],
  ['p-alert', { x: 10, y: 360 }],
]);
const clusterCenter = (c?: string) => {
  if (!c) return { x: 0, y: 0 };
  let p = clusterCenters.get(c);
  if (!p) {
    const a = clusterCenters.size * 2.1;
    p = { x: Math.cos(a) * 900, y: Math.sin(a) * 680 };
    clusterCenters.set(c, p);
  }
  return p;
};

const nodes = new Map<string, Node>();
const seeded = new Map<string, { x: number; y: number }>();

/**
 * How "low level" a kind is: projects are the top, builds the bottom. Related items pull
 * closer together the lower level they are (a build hugs its PR, a ticket sits further
 * from its project), and low-level bubbles push others away less.
 */
/**
 * Spacing falls off exponentially with depth: each level down the hierarchy keeps
 * FALLOFF times the distance of the level above (project-ticket 190, ticket-worktree
 * ~120, worktree-PR ~75, PR-build ~47).
 */
const FALLOFF = 0.63;
const decay = (level: number, top: number) => top * Math.pow(FALLOFF, Math.max(level - 1, 0));
/** extra gap (beyond both radii) between two linked bubbles, by the lower level of the pair */
const linkGap = (level: number) => decay(level, 190);
/** deeper links are stiffer, so small things really stay with their parent */
const linkStrength = (level: number) => 1 - decay(level, 0.6);
/** collision padding per kind; never below what the caption under the bubble needs */
const collidePad = (level: number) => Math.max(30, decay(level, 52));
/** low-level bubbles push the others away less */
const charge = (level: number) => (level === 0 ? -800 : -decay(level, 300));

const linkLevel = (l: SimLink) => Math.max((l.source as Node).level, (l.target as Node).level);

const sim = forceSimulation<Node>([])
  .alphaDecay(0.025)
  .velocityDecay(0.38)
  .force(
    'charge',
    forceManyBody<Node>()
      .strength((n) => charge(n.level))
      .distanceMax(800),
  )
  .force('collide', forceCollide<Node>((n) => n.r + collidePad(n.level)).strength(0.85))
  .force(
    'link',
    forceLink<Node, SimLink>([])
      .id((n) => n.id)
      .distance((l) => (l.source as Node).r + (l.target as Node).r + linkGap(linkLevel(l)))
      .strength((l) => linkStrength(linkLevel(l))),
  )
  .force('x', forceX<Node>((n) => clusterCenter(n.cluster).x).strength((n) => (n.anchor ? 0.2 : 0.04)))
  .force('y', forceY<Node>((n) => clusterCenter(n.cluster).y).strength((n) => (n.anchor ? 0.2 : 0.04)));

// idle until syncLayout gives it nodes (d3 would otherwise start its timer at import)
sim.stop();

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
export function syncLayout(items: Item[], links: Link[], metrics: Metrics) {
  let changed = false;
  const alive = new Set(items.map((i) => i.id));
  // oxlint-disable-next-line unicorn/no-useless-spread -- copy: we delete while iterating
  for (const id of [...nodes.keys()]) if (!alive.has(id)) (nodes.delete(id), (changed = true));
  for (const it of items) {
    if (nodes.has(it.id)) continue;
    changed = true;
    const { r, level } = metrics(it);
    // projects anchor their own cluster; everything else gravitates to its project's
    const cluster = it.projectId ?? (level === 0 ? it.id : undefined);
    const pinned = it.pos;
    const s = pinned ?? seeded.get(it.id);
    const linked = links.find((l) => l.from === it.id || l.to === it.id);
    const anchor = s ?? (linked && nodes.get(linked.from === it.id ? linked.to : linked.from)) ?? clusterCenter(cluster);
    const jitter = s ? 0 : 160;
    nodes.set(it.id, {
      id: it.id,
      r,
      level,
      anchor: level === 0,
      cluster,
      x: (anchor.x ?? 0) + (Math.random() - 0.5) * jitter,
      y: (anchor.y ?? 0) + (Math.random() - 0.5) * jitter,
      // dropped there by the user (saved with the item)
      ...(pinned && { fx: pinned.x, fy: pinned.y }),
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

let dragged: string[] = [];
export function dragStart(ids: string[]) {
  dragged = ids;
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
/** Dropped bubbles stay where you put them (until "Auto-arrange"); the spot is saved with the item. */
export function dragEnd() {
  sim.alphaTarget(0);
  const pos = new Map<string, { x: number; y: number }>();
  for (const id of dragged) {
    const n = nodes.get(id);
    if (n?.fx != null && n.fy != null) pos.set(id, { x: Math.round(n.fx), y: Math.round(n.fy) });
  }
  dragged = [];
  setPinned(pos);
}
export function unpinAll() {
  nodes.forEach((n) => ((n.fx = null), (n.fy = null)));
  clearPinned();
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
