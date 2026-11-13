/**
 * Right-hand details panel for one bubble, opened by double-clicking it. This is the shell
 * (header with expand / close, a drag handle on the left edge); the body is the kind's
 * `Sidebar` component or the generic `DefaultSidebar` (sidebar/index.tsx). Actions stay in the
 * floating list.
 *
 * Width: `settings.sidebarWidth` (persisted; drag the left edge). "Expand" goes wide (most of
 * the window) for webviews and diffs; kind sidebars can ask for it via `useSidebarLayout()`.
 */
import { MaximizeIcon, MinimizeIcon, XmarkIcon } from '@dynatrace/strato-icons';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from 'react';
import { kindIcon, kindLabel, sidebarOf, useCtx } from '../kinds/registry';
import type { SidebarProps } from '../kinds/types';
import { DefaultSidebar, SidebarLayoutContext } from '../sidebar';
import { inspect, setSettings, useStore } from '../store';

const MIN_W = 280;
const MARGIN = 16;
/** room left for the canvas when the sidebar is as wide as it gets */
const CANVAS_MIN = 160;

const clampW = (w: number) => Math.round(Math.max(MIN_W, Math.min(w, window.innerWidth - CANVAS_MIN)));
const wideW = () => clampW(Math.max(720, window.innerWidth * 0.62));

let currentW = 360;
/** Width the open sidebar takes on screen (the canvas keeps bubbles out from under it). */
export const sidebarWidth = () => currentW;

export function Sidebar() {
  const inspected = useStore((s) => s.inspected);
  const item = useStore((s) => (s.inspected ? s.items.find((i) => i.id === s.inspected) : undefined));
  const stored = useStore((s) => s.settings.sidebarWidth);
  const ctx = useCtx();
  const [drag, setDrag] = useState<number | null>(null);
  // expanded for this item (a newly inspected item starts narrow again)
  const [wideFor, setWideFor] = useState<string | null>(null);
  const wide = !!inspected && wideFor === inspected;
  const setWide = useCallback((w: boolean | ((cur: boolean) => boolean)) => setWideFor((cur) => ((typeof w === 'function' ? w(cur === inspected) : w) ? inspected : null)), [inspected]);
  const [, setVw] = useState(0);

  // re-clamp on window resize
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const width = drag ?? (wide ? wideW() : clampW(stored));
  useLayoutEffect(() => {
    currentW = inspected ? width : 0;
  }, [inspected, width]);
  const layout = useMemo(() => ({ wide, setWide: (w: boolean) => setWide(w), width }), [wide, setWide, width]);

  if (!inspected || !item) return null;
  const Body = (sidebarOf(item.kind) ?? DefaultSidebar) as ComponentType<SidebarProps>;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDrag(clampW(window.innerWidth - MARGIN - ev.clientX));
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      const w = clampW(window.innerWidth - MARGIN - ev.clientX);
      setDrag(null);
      setWide(false);
      setSettings({ sidebarWidth: w });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <aside
      className={`sidebar ${drag != null ? 'is-resizing' : ''}`}
      key={item.id}
      style={{ width }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`${kindLabel(item.kind)} details`}
    >
      <div className="sidebar-resize" onPointerDown={startDrag} onDoubleClick={() => setWide((w) => !w)} title="Drag to resize · double-click to expand" />
      <header className="sidebar-head">
        <span className="sidebar-kind">
          {kindIcon(item.kind, 14)}
          <span>{kindLabel(item.kind)}</span>
        </span>
        <span className="sidebar-handle">@{item.handle}</span>
        <button className="sidebar-close" onClick={() => setWide((w) => !w)} aria-label={wide ? 'Narrow the sidebar' : 'Expand the sidebar'} title={wide ? 'Narrow' : 'Expand'}>
          {wide ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
        <button className="sidebar-close" onClick={() => inspect(null)} aria-label="Close details (Esc)">
          <XmarkIcon />
        </button>
      </header>
      <div className="sidebar-body">
        <SidebarLayoutContext.Provider value={layout}>
          <Body item={item} ctx={ctx} />
        </SidebarLayoutContext.Provider>
      </div>
    </aside>
  );
}
