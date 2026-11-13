/**
 * Right-hand details panel for one bubble, opened by double-clicking it. This is the shell
 * (header + close); the body is the kind's `Sidebar` component or the generic
 * `DefaultSidebar` (sidebar/index.tsx). Actions stay in the floating list.
 */
import { XmarkIcon } from '@dynatrace/strato-icons';
import type { ComponentType } from 'react';
import { kindIcon, kindLabel, sidebarOf, useCtx } from '../kinds/registry';
import type { SidebarProps } from '../kinds/types';
import { DefaultSidebar } from '../sidebar';
import { inspect, useStore } from '../store';

export const SIDEBAR_W = 320;

export function Sidebar() {
  const inspected = useStore((s) => s.inspected);
  const item = useStore((s) => (s.inspected ? s.items.find((i) => i.id === s.inspected) : undefined));
  const ctx = useCtx();
  if (!inspected || !item) return null;
  const Body = (sidebarOf(item.kind) ?? DefaultSidebar) as ComponentType<SidebarProps>;

  return (
    <aside className="sidebar" key={item.id} style={{ width: SIDEBAR_W }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${kindLabel(item.kind)} details`}>
      <header className="sidebar-head">
        <span className="sidebar-kind">
          {kindIcon(item.kind, 14)}
          <span>{kindLabel(item.kind)}</span>
        </span>
        <span className="sidebar-handle">@{item.handle}</span>
        <button className="sidebar-close" onClick={() => inspect(null)} aria-label="Close details (Esc)">
          <XmarkIcon />
        </button>
      </header>
      <div className="sidebar-body">
        <Body item={item} ctx={ctx} />
      </div>
    </aside>
  );
}
