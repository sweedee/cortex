import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@dynatrace/strato-components/navigation';
import { DeleteIcon, PinOffIcon, ZoomToFitIcon, ChatIcon, LinkIcon } from '@dynatrace/strato-icons';
import { Backdrop } from './Backdrop';
import { Bubble } from './Bubble';
import { Links } from './Links';
import { HoverCard, InlineActions } from './Overlays';
import { SIDEBAR_W } from '../overlays/Sidebar';
import { KIND_RADIUS } from '../model';
import {
  bounds,
  camera,
  dragBy,
  dragEnd,
  dragStart,
  positionOf,
  syncLayout,
  unpinAll,
  useLayoutTick,
  warmUp,
} from '../layout';
import { actionsForItem, actionsForSelection, KINDS_ADDABLE, relatedItems, removeSelected } from '../actions';
import { focusChat, getState, insertSkill, inspect, mentionedIds, openDialog, removeItems, select, setHovered, useStore, useVisible, visibleSet } from '../store';
import { accentOf, groupFill, KIND_ICON, useItemColors } from '../visual';

type Cam = { x: number; y: number; k: number };
type MenuState = { sx: number; sy: number; wx: number; wy: number; itemId?: string } | null;

const MIN_K = 0.25;
const MAX_K = 2.2;
const CHAT_SPACE = 170; // px reserved at the bottom for the chat box
const TOP_SPACE = 70;
const MAX_RELATED = 6;
/** px covered by the details sidebar on the right (0 when it is closed) */
const rightSpace = () => (getState().inspected ? SIDEBAR_W + 32 : 0);

export function Canvas() {
  const items = useStore((s) => s.items);
  const links = useStore((s) => s.links);
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const draft = useStore((s) => s.draft);
  const visible = useVisible();
  const search = useStore((s) => s.search);
  const colors = useItemColors();
  useLayoutTick();

  const cam = useRef<Cam>({ x: window.innerWidth / 2, y: window.innerHeight / 2, k: 1 });
  const [, setCamTick] = useState(0);
  const rerender = useCallback(() => setCamTick((t) => t + 1), []);
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverShown, setHoverShown] = useState<string | null>(null);
  const firstIds = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  // ---- layout sync ------------------------------------------------------------------
  const booted = useRef(false);
  useLayoutEffect(() => {
    syncLayout(items, links);
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
        setTimeout(() => setFreshIds(new Set()), 900);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, links]);

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
        rerender();
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [rerender],
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
      rerender();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rerender]);

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
      const free = window.innerWidth - SIDEBAR_W - 32;
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, [contenteditable="true"], [role="dialog"]');
      if (e.key === 'Escape' && !typing) {
        // first Esc closes the details sidebar, the next one clears the selection
        if (getState().inspected) inspect(null);
        else select([]);
      }
      if (typing) return;
      if (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        focusChat();
      } else if (e.key === 'f' || e.key === 'F') fitTo(getState().selected.length ? getState().selected : undefined);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && getState().selected.length) removeSelected();
      else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        select([...visibleSet()]);
      } else if (e.key === 'Enter' && getState().selected.length) {
        const { actions, items: its } = actionsForSelection(getState().selected);
        actions.find((a) => a.primary && !a.disabled)?.run(its);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitTo]);

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
  const mentioned = useMemo(() => new Set(mentionedIds(draft, items)), [draft, items]);
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
  const sel = actionsForSelection(selected.filter((id) => !hiddenSet.has(id)));

  // inline actions sit under the selection
  // inline actions: a vertical list beside the selection (flips left near the right edge)
  let actionsAt: { x: number; y: number; flip: boolean } | null = null;
  if (sel.items.length && !dragging) {
    const b = bounds(sel.items.map((i) => i.id));
    if (b) {
      const right = toScreen(b.x1, b.y0);
      const left = toScreen(b.x0, b.y0);
      const flip = right.x + 16 + 230 > window.innerWidth - rightSpace();
      const nRel = Math.min(relatedItems(sel.items.map((i) => i.id)).filter((i) => !hiddenSet.has(i.id)).length, MAX_RELATED);
      const height = sel.actions.length * 34 + (sel.items.length > 1 ? 30 : 0) + (nRel ? nRel * 30 + 30 : 0) + 10;
      const y = Math.max(TOP_SPACE, Math.min(right.y, window.innerHeight - CHAT_SPACE - height));
      actionsAt = { x: flip ? left.x - 16 : right.x + 16, y, flip };
    }
  }

  // hover card next to the bubble
  let hoverCard: React.ReactNode = null;
  const hItem = hoverShown ? itemMap.get(hoverShown) : undefined;
  if (hItem && !dragging && !menu && !selected.includes(hItem.id)) {
    const p = positionOf(hItem.id);
    if (p) {
      const r = KIND_RADIUS[hItem.kind] * k;
      const s = toScreen(p.x!, p.y!);
      const flip = s.x + r + 300 > window.innerWidth - rightSpace();
      hoverCard = <HoverCard item={hItem} x={flip ? s.x - r - 18 : s.x + r + 18} y={s.y} flip={flip} />;
    }
  }

  // threads from the chat box to every mentioned bubble
  const chatThreads = [...mentioned]
    .filter((id) => !hiddenSet.has(id))
    .map((id) => {
      const p = positionOf(id);
      return p ? { id, ...toScreen(p.x!, p.y!) } : null;
    })
    .filter(Boolean) as { id: string; x: number; y: number }[];
  const chatEl = document.querySelector('.chatbox');
  const chatRect = chatEl?.getBoundingClientRect();

  const menuItem = menu?.itemId ? itemMap.get(menu.itemId) : undefined;
  const menuSel = menu?.itemId ? actionsForSelection(getState().selected) : null;
  const menuRelated = menuSel ? relatedItems(menuSel.items.map((i) => i.id)).filter((i) => !hiddenSet.has(i.id)).slice(0, 8) : [];

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
    >
      <Backdrop cam={cam} />
      <div className="world" style={{ transform: `translate(${cx}px, ${cy}px) scale(${k})` }}>
        <Links links={links} items={itemMap} active={activeLinks} hidden={hiddenSet} />
        {items.map((it) => {
          if (hiddenSet.has(it.id)) return null;
          const p = positionOf(it.id);
          if (!p || p.x == null) return null;
          return (
            <Bubble
              key={it.id}
              item={it}
              x={p.x}
              y={p.y!}
              selected={selected.includes(it.id)}
              lit={lit.has(it.id) && !focus.has(it.id)}
              dimmed={isDimmed(it.id)}
              mentioned={mentioned.has(it.id)}
              hit={!!hits?.has(it.id)}
              hitActive={search?.active === it.id}
              isNew={freshIds.has(it.id)}
              fill={fills.get(it.id)}
              accent={accentOf(colors, it.id)}
            />
          );
        })}
      </div>

      {chatRect && chatThreads.length > 0 && (
        <svg className="chat-threads" width="100%" height="100%" aria-hidden>
          {chatThreads.map((t, i) => {
            const ox = chatRect.left + chatRect.width / 2 + (i - (chatThreads.length - 1) / 2) * 26;
            const oy = chatRect.top;
            return <path key={t.id} d={`M${ox},${oy} C${ox},${oy - 120} ${t.x},${t.y + 140} ${t.x},${t.y}`} style={{ stroke: accentOf(colors, t.id) }} />;
          })}
        </svg>
      )}

      {hoverCard}
      {actionsAt && (
        <InlineActions
          key={selected.join(',')}
          actions={sel.actions}
          items={sel.items}
          related={relatedItems(sel.items.map((i) => i.id))
            .filter((i) => !hiddenSet.has(i.id))
            .slice(0, MAX_RELATED)}
          colors={colors}
          x={actionsAt.x}
          y={actionsAt.y}
          flip={actionsAt.flip}
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
                          <Menu.Prefix>{KIND_ICON[r.kind](16)}</Menu.Prefix>
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
                  <Menu.Item onSelect={() => removeItems(menuSel.items.map((i) => i.id))}>
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
                    <Menu.Item key={k.kind} onSelect={() => openDialog({ type: 'add', kind: k.kind, at: { x: menu.wx, y: menu.wy } })}>
                      <Menu.Prefix>{KIND_ICON[k.kind](16)}</Menu.Prefix>
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
                  <Menu.Item onSelect={() => openDialog({ type: 'add', kind: 'ticket', at: { x: menu.wx, y: menu.wy } })}>
                    <Menu.Prefix>
                      <LinkIcon />
                    </Menu.Prefix>
                    Paste a link…
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

