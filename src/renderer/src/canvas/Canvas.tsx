import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@dynatrace/strato-components/navigation';
import { DeleteIcon, PinOffIcon, ZoomToFitIcon, ChatIcon, LinkIcon, ResetIcon } from '@dynatrace/strato-icons';
import { Backdrop } from './Backdrop';
import { Bubble } from './Bubble';
import { ChatThreads } from './ChatThreads';
import { Links } from './Links';
import { HoverCard, InlineActions } from './Overlays';
import { ARROW_DIRECTION, nearestInDirection, tabStopOf } from './nav';
import { bubbleElement, placeAll, useFollow } from './positions';
import { openShortcuts } from '../overlays/Shortcuts';
import { sidebarWidth } from '../overlays/Sidebar';
import { kindIcon, levelOf, radiusOf, useViews } from '../kinds/registry';
import type { Metrics } from '../layout';
import {
  bounds,
  camera,
  dragBy,
  dragEnd,
  dragStart,
  positionOf,
  syncLayout,
  unpinAll,
  warmUp,
} from '../layout';
import { resetToDemo } from '../persist';
import { actionsForItem, actionsForSelection, KINDS_ADDABLE, openAdd, PASTE_KIND, relatedItems, removeSelected } from '../actions';
import { removeWithUndo } from '../kinds/common';
import { draftMentions, focusChat, getState, insertSkill, inspect, openDialog, select, setHovered, useStore, useVisible, visibleSet } from '../store';
import { applyMetricVars, METRICS } from '../ui/metrics';
import { matchShortcut } from '../ui/shortcuts';
import { accentOf, groupFill, useItemColors } from '../visual';

const metrics: Metrics = (it) => ({ r: radiusOf(it.kind), level: levelOf(it.kind) });

type Cam = { x: number; y: number; k: number };
type MenuState = { sx: number; sy: number; wx: number; wy: number; itemId?: string } | null;

const MIN_K = 0.25;
const MAX_K = 2.2;
const { chatSpace: CHAT_SPACE, topSpace: TOP_SPACE } = METRICS;
// the stylesheet reads the same sizes as CSS custom properties
applyMetricVars();
const MAX_RELATED = 6;
/** px covered by the details sidebar on the right (0 when it is closed) */
const rightSpace = () => (getState().inspected ? sidebarWidth() + 32 : 0);
/** how long the world layer stays promoted (will-change) after the last pan / zoom step */
const MOVING_MS = 200;

/**
 * The bubble canvas. It re-renders on store and camera changes only: layout ticks move
 * bubbles, links and the overlays that follow them imperatively (positions.ts).
 */
export function Canvas() {
  const items = useStore((s) => s.items);
  const links = useStore((s) => s.links);
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  // only the mentioned ids, not the draft: typing plain text does not re-render the canvas
  const mentionedList = useStore(draftMentions);
  const visible = useVisible();
  const search = useStore((s) => s.search);
  const colors = useItemColors();
  const views = useViews();

  const cam = useRef<Cam>({ x: window.innerWidth / 2, y: window.innerHeight / 2, k: 1 });
  const [, setCamTick] = useState(0);
  const rerender = useCallback(() => setCamTick((t) => t + 1), []);
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverShown, setHoverShown] = useState<string | null>(null);
  const firstIds = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const freshTimer = useRef(0);
  const fitTimer = useRef(0);
  const movingTimer = useRef(0);

  // ---- layout sync ------------------------------------------------------------------
  const booted = useRef(false);
  useLayoutEffect(() => {
    syncLayout(items, links, metrics);
    if (!booted.current) {
      booted.current = true;
      warmUp();
      firstIds.current = new Set(items.map((i) => i.id));
      fitTo(undefined, false);
    } else {
      const fresh = items.filter((i) => !firstIds.current!.has(i.id)).map((i) => i.id);
      fresh.forEach((id) => firstIds.current!.add(id));
      if (fresh.length) {
        setFreshIds(new Set(fresh));
        clearTimeout(freshTimer.current);
        freshTimer.current = window.setTimeout(() => setFreshIds(new Set()), 900);
      }
    }
    // new bubbles (and their links) are mounted by now: put them in place before the paint
    placeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, links]);

  useEffect(
    () => () => {
      clearTimeout(freshTimer.current);
      clearTimeout(fitTimer.current);
      clearTimeout(movingTimer.current);
      cancelAnimationFrame(anim.current);
    },
    [],
  );

  /** Promote the world to its own layer only while the camera moves (one huge layer otherwise). */
  const moving = useCallback(() => {
    world.current?.classList.add('is-moving');
    clearTimeout(movingTimer.current);
    movingTimer.current = window.setTimeout(() => world.current?.classList.remove('is-moving'), MOVING_MS);
  }, []);

  // ---- camera -------------------------------------------------------------------------
  const anim = useRef(0);
  const animateTo = useCallback(
    (target: Cam, ms = 480) => {
      cancelAnimationFrame(anim.current);
      const from = { ...cam.current };
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min((t - t0) / ms, 1);
        const e = 1 - Math.pow(1 - p, 3);
        cam.current = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
        moving();
        rerender();
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [rerender, moving],
  );

  const fitTo = useCallback(
    (ids?: string[], animate = true, maxK = 1.1) => {
      const b = bounds(ids);
      if (!b) return;
      const W = window.innerWidth - rightSpace(),
        H = window.innerHeight - CHAT_SPACE - TOP_SPACE;
      const pad = 80;
      const k = Math.max(MIN_K, Math.min(maxK, (W - pad * 2) / (b.x1 - b.x0), (H - pad) / (b.y1 - b.y0)));
      const target = { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: TOP_SPACE + H / 2 - ((b.y0 + b.y1) / 2) * k };
      if (animate) animateTo(target);
      else ((cam.current = target), rerender());
    },
    [animateTo, rerender],
  );

  useEffect(() => {
    camera.center = () => {
      const { x, y, k } = cam.current;
      return { x: ((window.innerWidth - rightSpace()) / 2 - x) / k, y: ((window.innerHeight - CHAT_SPACE) / 2 - y) / k };
    };
    camera.focus = (ids) => fitTo(ids, true, 1.05);
    camera.fit = () => fitTo();
    camera.zoom = (f) => {
      const { x, y, k } = cam.current;
      const nk = Math.min(MAX_K, Math.max(MIN_K, k * f));
      const sx = window.innerWidth / 2,
        sy = (window.innerHeight - CHAT_SPACE) / 2;
      animateTo({ k: nk, x: sx - ((sx - x) / k) * nk, y: sy - ((sy - y) / k) * nk }, 220);
    };
  }, [fitTo, animateTo]);

  const toWorld = (sx: number, sy: number) => {
    const { x, y, k } = cam.current;
    return { x: (sx - x) / k, y: (sy - y) / k };
  };
  const toScreen = (wx: number, wy: number) => {
    const { x, y, k } = cam.current;
    return { x: wx * k + x, y: wy * k + y };
  };

  // wheel zoom around the cursor (needs a non-passive listener)
  useEffect(() => {
    const el = root.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.chatbox, .hud, .sidebar, [role="menu"], [role="dialog"]')) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const { x, y, k } = cam.current;
      const nk = Math.min(MAX_K, Math.max(MIN_K, k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const wx = (e.clientX - x) / k,
        wy = (e.clientY - y) / k;
      cam.current = { k: nk, x: e.clientX - wx * nk, y: e.clientY - wy * nk };
      moving();
      rerender();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rerender, moving]);

  // ---- pointer: pan, drag, marquee ------------------------------------------------------
  const gesture = useRef<
    | { type: 'pan'; sx: number; sy: number; cx: number; cy: number; moved: boolean }
    | { type: 'drag'; ids: string[]; lx: number; ly: number; moved: boolean; id: string; additive: boolean }
    | { type: 'marquee'; x0: number; y0: number; base: string[] }
    | null
  >(null);

  /** React events bubble out of portals (menus, dialogs); only handle real canvas events. */
  const outside = (e: React.SyntheticEvent) => !root.current?.contains(e.target as Node);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || outside(e)) return;
    if ((e.target as HTMLElement).closest('.inline-actions, .hover-card, .sidebar')) return;
    setMenu(null);
    const bubble = (e.target as HTMLElement).closest<HTMLElement>('.bubble');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (bubble) {
      const id = bubble.dataset.id!;
      const sel = getState().selected;
      const ids = sel.includes(id) && !additive ? sel : [id];
      gesture.current = { type: 'drag', ids, lx: e.clientX, ly: e.clientY, moved: false, id, additive };
      return;
    }
    if (e.shiftKey) {
      gesture.current = { type: 'marquee', x0: e.clientX, y0: e.clientY, base: getState().selected };
      setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      return;
    }
    gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) {
      if (outside(e)) return;
      const bubble = (e.target as HTMLElement).closest<HTMLElement>('.bubble');
      setHovered(bubble?.dataset.id ?? null);
      return;
    }
    if (g.type === 'pan') {
      const dx = e.clientX - g.sx,
        dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      cancelAnimationFrame(anim.current);
      cam.current = { ...cam.current, x: g.cx + dx, y: g.cy + dy };
      moving();
      rerender();
    } else if (g.type === 'drag') {
      const dx = e.clientX - g.lx,
        dy = e.clientY - g.ly;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < 4) return;
        g.moved = true;
        dragStart(g.ids);
        setDragging(true);
      }
      g.lx = e.clientX;
      g.ly = e.clientY;
      dragBy(g.ids, dx / cam.current.k, dy / cam.current.k);
    } else {
      const m = { x0: g.x0, y0: g.y0, x1: e.clientX, y1: e.clientY };
      setMarquee(m);
      const a = toWorld(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
      const b = toWorld(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
      const vis = visibleSet();
      const inside = getState()
        .items.filter((i) => vis.has(i.id))
        .filter((i) => {
          const p = positionOf(i.id);
          return p && p.x! >= a.x && p.x! <= b.x && p.y! >= a.y && p.y! <= b.y;
        })
        .map((i) => i.id);
      select([...new Set([...g.base, ...inside])]);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.type === 'pan' && !g.moved) select([]);
    if (g.type === 'drag') {
      if (g.moved) {
        dragEnd();
        setDragging(false);
      } else select([g.id], g.additive);
    }
    if (g.type === 'marquee') setMarquee(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (outside(e)) return;
    // pointer capture retargets dblclick to the canvas, so hit-test the point instead
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (hit?.closest('.inline-actions, .hover-card, .sidebar')) return;
    const bubble = hit?.closest<HTMLElement>('.bubble');
    if (!bubble) return fitTo();
    // double-click opens the details sidebar
    const id = bubble.dataset.id!;
    select([id]);
    inspect(id);
    // keep the bubble in view: pan it out from under the sidebar
    const p = positionOf(id);
    if (p) {
      const free = window.innerWidth - sidebarWidth() - 32;
      const sx = toScreen(p.x!, p.y!).x;
      if (sx > free - 60) animateTo({ ...cam.current, x: cam.current.x - (sx - free / 2) });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (outside(e)) return;
    if ((e.target as HTMLElement).closest('.chatbox, .hud, .inline-actions, .sidebar')) return;
    e.preventDefault();
    const bubble = (e.target as HTMLElement).closest<HTMLElement>('.bubble');
    const w = toWorld(e.clientX, e.clientY);
    if (bubble) {
      const id = bubble.dataset.id!;
      if (!getState().selected.includes(id)) select([id]);
      setMenu({ sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, itemId: id });
    } else setMenu({ sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y });
  };

  // ---- keyboard -------------------------------------------------------------------------
  // the shortcuts come from one table (ui/shortcuts.ts), which the `?` overlay lists too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, [contenteditable="true"], [role="dialog"]');
      if (typing) return;
      switch (matchShortcut(e, 'canvas')) {
        case 'escape':
          // first Esc closes the details sidebar, the next one clears the selection
          if (getState().inspected) inspect(null);
          else select([]);
          break;
        case 'chat':
          e.preventDefault();
          focusChat();
          break;
        case 'fit':
          fitTo(getState().selected.length ? getState().selected : undefined);
          break;
        case 'remove':
          if (getState().selected.length) removeSelected();
          break;
        case 'selectAll':
          e.preventDefault();
          select([...visibleSet()]);
          break;
        case 'primary':
          if (getState().selected.length) {
            const { actions, items: its } = actionsForSelection(getState().selected);
            actions.find((a) => a.primary && !a.disabled)?.run(its);
          }
          break;
        case 'help':
          e.preventDefault();
          openShortcuts();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitTo]);

  // ---- keyboard focus on bubbles: one tab stop, arrow keys between bubbles (canvas/nav.ts) ----
  /** the bubble that has keyboard focus (null once focus leaves the bubbles) */
  const [focusId, setFocusId] = useState<string | null>(null);
  const bubbleOf = (el: EventTarget | null) => (el instanceof HTMLElement && el.classList.contains('bubble') ? el.dataset.id : undefined);

  /** Focus a bubble and pan it into view if it is off screen. */
  const focusBubble = (id: string) => {
    bubbleElement(id)?.focus({ preventScroll: true });
    const p = positionOf(id);
    if (p?.x == null || p.y == null) return;
    const s = toScreen(p.x, p.y);
    const W = window.innerWidth - rightSpace(),
      H = window.innerHeight - CHAT_SPACE;
    const m = 60;
    if (s.x < m || s.x > W - m || s.y < TOP_SPACE + m / 2 || s.y > H - m / 2)
      animateTo({ ...cam.current, x: cam.current.x + (W / 2 - s.x), y: cam.current.y + (TOP_SPACE + (H - TOP_SPACE) / 2 - s.y) }, 260);
  };

  const onBubbleKey = (e: React.KeyboardEvent) => {
    const id = bubbleOf(e.target);
    if (!id || e.nativeEvent.isComposing) return;
    switch (matchShortcut(e, 'bubble')) {
      case 'move': {
        e.preventDefault();
        const from = positionOf(id);
        if (from?.x == null || from.y == null) return;
        const vis = visibleSet();
        const points = getState()
          .items.filter((i) => vis.has(i.id) && i.id !== id)
          .map((i) => ({ id: i.id, p: positionOf(i.id) }))
          .filter((c) => c.p?.x != null && c.p.y != null)
          .map((c) => ({ id: c.id, x: c.p!.x!, y: c.p!.y! }));
        const next = nearestInDirection({ x: from.x, y: from.y }, ARROW_DIRECTION[e.key]!, points);
        if (next) focusBubble(next);
        break;
      }
      case 'open':
        // like a double-click: select it and open the details (not the selection's main action)
        e.preventDefault();
        e.stopPropagation();
        select([id]);
        inspect(id);
        break;
      case 'toggle':
        e.preventDefault();
        select([id], true);
        break;
    }
  };
  // hover card appears after a short delay
  useEffect(() => {
    setHoverShown(null);
    if (!hovered) return;
    const t = setTimeout(() => setHoverShown(hovered), 380);
    return () => clearTimeout(t);
  }, [hovered]);

  // ---- derived visuals ----------------------------------------------------------------------
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const fills = useMemo(() => {
    const m = new Map<string, string | undefined>();
    colors.forEach((cs, id) => m.set(id, groupFill(cs)));
    return m;
  }, [colors]);
  const hiddenSet = useMemo(() => new Set(items.filter((i) => !visible.has(i.id)).map((i) => i.id)), [items, visible]);
  const mentioned = useMemo(() => new Set(mentionedList), [mentionedList]);
  const hits = useMemo(() => (search ? new Set(search.ids) : null), [search]);
  const focus = useMemo(() => {
    const f = new Set(selected);
    if (hovered) f.add(hovered);
    return f;
  }, [selected, hovered]);
  const { activeLinks, lit } = useMemo(() => {
    const activeLinks = new Set<string>();
    const lit = new Set<string>();
    for (const l of links) {
      if (focus.has(l.from) || focus.has(l.to)) {
        activeLinks.add(l.id);
        lit.add(l.from);
        lit.add(l.to);
      }
    }
    mentioned.forEach((m) => lit.add(m));
    return { activeLinks, lit };
  }, [links, focus, mentioned]);
  const dimming = focus.size > 0 || mentioned.size > 0;
  const isDimmed = (id: string) => (hits ? !hits.has(id) : dimming && !lit.has(id) && !focus.has(id));

  const { x: cx, y: cy, k } = cam.current;
  const shownIds = useMemo(() => items.filter((i) => !hiddenSet.has(i.id)).map((i) => i.id), [items, hiddenSet]);
  const tabStop = tabStopOf(focusId, selected, shownIds);
  // derived from the store only (not positions), so memoized across camera renders
  const sel = useMemo(
    () => actionsForSelection(selected.filter((id) => !hiddenSet.has(id))),
    // items / links: the actions read them through the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, hiddenSet, items, links],
  );
  const selIds = useMemo(() => sel.items.map((i) => i.id), [sel]);
  const related = useMemo(
    () => relatedItems(selIds).filter((i) => !hiddenSet.has(i.id)).slice(0, MAX_RELATED),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selIds, hiddenSet, items, links],
  );

  // inline actions: a vertical list beside the selection (flips left near the right edge)
  const [actionsRef, actionsAt] = useFollow(() => {
    if (!selIds.length || dragging) return null;
    const b = bounds(selIds);
    if (!b) return null;
    const right = toScreen(b.x1, b.y0);
    const left = toScreen(b.x0, b.y0);
    const flip = right.x + METRICS.actionsGap + METRICS.actionsWidth > window.innerWidth - rightSpace();
    const nRel = related.length;
    const height = sel.actions.length * 34 + (sel.items.length > 1 ? 30 : 0) + (nRel ? nRel * 30 + 30 : 0) + 10;
    const y = Math.max(TOP_SPACE, Math.min(right.y, window.innerHeight - CHAT_SPACE - height));
    return { x: flip ? left.x - METRICS.actionsGap : right.x + METRICS.actionsGap, y, flip };
  });

  // hover card next to the bubble
  const hItem = hoverShown ? itemMap.get(hoverShown) : undefined;
  const hoverItem = hItem && !dragging && !menu && !selected.includes(hItem.id) ? hItem : undefined;
  const [hoverRef, hoverAt] = useFollow(() => {
    const p = hoverItem && positionOf(hoverItem.id);
    if (!hoverItem || p?.x == null || p.y == null) return null;
    const r = radiusOf(hoverItem.kind) * cam.current.k;
    const s = toScreen(p.x, p.y);
    const gap = METRICS.hoverCardGap;
    const flip = s.x + r + gap + METRICS.hoverCardWidth > window.innerWidth - rightSpace();
    return { x: flip ? s.x - r - gap : s.x + r + gap, y: s.y, flip };
  });

  // threads from the chat box to every mentioned bubble
  const threadIds = useMemo(() => mentionedList.filter((id) => !hiddenSet.has(id)), [mentionedList, hiddenSet]);

  const menuItem = menu?.itemId ? itemMap.get(menu.itemId) : undefined;
  const menuSel = useMemo(
    () => (menu?.itemId ? actionsForSelection(selected) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, selected, items, links],
  );
  const menuRelated = useMemo(
    () => (menuSel ? relatedItems(menuSel.items.map((i) => i.id)).filter((i) => !hiddenSet.has(i.id)).slice(0, 8) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuSel, hiddenSet, items, links],
  );

  return (
    <div
      ref={root}
      className={`canvas ${dragging ? 'is-dragging' : ''} ${k < 0.55 ? 'zoom-far' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !gesture.current && setHovered(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onBubbleKey}
      onFocus={(e) => {
        const id = bubbleOf(e.target);
        if (id && id !== focusId) setFocusId(id);
      }}
      onBlur={(e) => {
        // leaving the bubbles: the tab stop goes back to the selection / first bubble
        if (bubbleOf(e.target) && !bubbleOf(e.relatedTarget)) setFocusId(null);
      }}
    >
      <Backdrop cam={cam} />
      <div ref={world} className="world" role="group" aria-label="Canvas: Tab to the bubbles, arrow keys between them, ? for all shortcuts" style={{ transform: `translate(${cx}px, ${cy}px) scale(${k})` }}>
        <Links links={links} views={views} active={activeLinks} hidden={hiddenSet} />
        {items.map((it) => {
          if (hiddenSet.has(it.id)) return null;
          return (
            <Bubble
              key={it.id}
              item={it}
              view={views.get(it.id)!}
              selected={selected.includes(it.id)}
              lit={lit.has(it.id) && !focus.has(it.id)}
              dimmed={isDimmed(it.id)}
              mentioned={mentioned.has(it.id)}
              hit={!!hits?.has(it.id)}
              hitActive={search?.active === it.id}
              isNew={freshIds.has(it.id)}
              fill={fills.get(it.id)}
              accent={accentOf(colors, it.id)}
              tabbable={it.id === tabStop}
            />
          );
        })}
      </div>

      <ChatThreads ids={threadIds} colors={colors} cam={cam.current} />

      {hoverItem && hoverAt && <HoverCard elRef={hoverRef} item={hoverItem} x={hoverAt.x} y={hoverAt.y} flip={!!hoverAt.flip} />}
      {actionsAt && (
        <InlineActions
          key={selected.join(',')}
          elRef={actionsRef}
          actions={sel.actions}
          items={sel.items}
          related={related}
          colors={colors}
          x={actionsAt.x}
          y={actionsAt.y}
          flip={!!actionsAt.flip}
        />
      )}

      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}

      {menu && (
        <Menu open onOpenChange={(o) => !o && setMenu(null)}>
          <Menu.Trigger>
            <button className="menu-anchor" style={{ left: menu.sx, top: menu.sy }} aria-label="Canvas menu" />
          </Menu.Trigger>
          <Menu.Content side="bottom" alignment="start">
            {menuItem && menuSel ? (
              <>
                <Menu.Group>
                  <Menu.Label>{menuSel.items.length > 1 ? `${menuSel.items.length} items` : `@${menuItem.handle}`}</Menu.Label>
                  {menuSel.actions.map((a) => (
                    <Menu.Item key={a.id} disabled={!!a.disabled} onSelect={() => a.run(menuSel.items)}>
                      <Menu.Prefix>{a.icon}</Menu.Prefix>
                      {a.label}
                      {a.skill && (
                        <Menu.Suffix>
                          <span className="menu-skill">/{a.skill}</span>
                        </Menu.Suffix>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Group>
                {menuRelated.length > 0 && (
                  <Menu.Group>
                    <Menu.Label>Related</Menu.Label>
                    {menuRelated.map((r) => (
                      <Menu.Sub key={r.id}>
                        <Menu.SubTrigger textValue={r.handle}>
                          <Menu.Prefix>{kindIcon(r.kind, 16)}</Menu.Prefix>
                          {r.handle}
                        </Menu.SubTrigger>
                        <Menu.SubContent>
                          <Menu.Label>{r.title}</Menu.Label>
                          {actionsForItem(r).map((a) => (
                            <Menu.Item key={a.id} disabled={!!a.disabled} onSelect={() => a.run([r])}>
                              <Menu.Prefix>{a.icon}</Menu.Prefix>
                              {a.label}
                            </Menu.Item>
                          ))}
                          <Menu.Item onSelect={() => (select([r.id]), fitTo([r.id], true, 1.05))}>
                            <Menu.Prefix>
                              <ZoomToFitIcon />
                            </Menu.Prefix>
                            Select and zoom to
                          </Menu.Item>
                        </Menu.SubContent>
                      </Menu.Sub>
                    ))}
                  </Menu.Group>
                )}
                <Menu.Group>
                  <Menu.Item onSelect={() => insertSkill(null, menuSel.items.map((i) => i.id))}>
                    <Menu.Prefix>
                      <ChatIcon />
                    </Menu.Prefix>
                    Mention in chat
                  </Menu.Item>
                  <Menu.Item onSelect={() => fitTo(menuSel.items.map((i) => i.id), true, 1.05)}>
                    <Menu.Prefix>
                      <ZoomToFitIcon />
                    </Menu.Prefix>
                    Zoom to
                  </Menu.Item>
                  <Menu.Item onSelect={() => removeWithUndo(menuSel.items)}>
                    <Menu.Prefix>
                      <DeleteIcon />
                    </Menu.Prefix>
                    Remove from canvas
                  </Menu.Item>
                </Menu.Group>
              </>
            ) : (
              <>
                <Menu.Group>
                  <Menu.Label>Add to canvas</Menu.Label>
                  {KINDS_ADDABLE.map((k) => (
                    <Menu.Item key={k.kind} onSelect={() => openAdd(k.kind, { x: menu.wx, y: menu.wy })}>
                      <Menu.Prefix>{kindIcon(k.kind, 16)}</Menu.Prefix>
                      {k.label}
                    </Menu.Item>
                  ))}
                </Menu.Group>
                <Menu.Group>
                  <Menu.Label>Canvas</Menu.Label>
                  <Menu.Item onSelect={() => fitTo()}>
                    <Menu.Prefix>
                      <ZoomToFitIcon />
                    </Menu.Prefix>
                    Fit everything
                  </Menu.Item>
                  <Menu.Item onSelect={() => unpinAll()}>
                    <Menu.Prefix>
                      <PinOffIcon />
                    </Menu.Prefix>
                    Auto-arrange
                  </Menu.Item>
                  <Menu.Item onSelect={() => openDialog({ type: 'add', kind: PASTE_KIND, at: { x: menu.wx, y: menu.wy } })}>
                    <Menu.Prefix>
                      <LinkIcon />
                    </Menu.Prefix>
                    Paste a link…
                  </Menu.Item>
                </Menu.Group>
                <Menu.Group>
                  <Menu.Item
                    onSelect={() =>
                      openDialog({
                        type: 'confirm',
                        title: 'Reset workspace to demo data?',
                        body: 'Replaces every bubble and link on the canvas with the demo world. The saved workspace is overwritten.',
                        confirm: 'Reset',
                        danger: true,
                        onConfirm: () =>
                          void resetToDemo().then(() => {
                            unpinAll();
                            clearTimeout(fitTimer.current);
                            fitTimer.current = window.setTimeout(() => fitTo(), 50);
                          }),
                      })
                    }
                  >
                    <Menu.Prefix>
                      <ResetIcon />
                    </Menu.Prefix>
                    Reset workspace to demo data
                  </Menu.Item>
                </Menu.Group>
              </>
            )}
          </Menu.Content>
        </Menu>
      )}
    </div>
  );
}

