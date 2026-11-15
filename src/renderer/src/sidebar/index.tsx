/**
 * Building blocks of the details sidebar. The shell (header with kind, handle and close
 * button) is `overlays/Sidebar.tsx`; the body is the kind's `Sidebar` component, or
 * `DefaultSidebar`. Kind sidebars compose these sections plus their own.
 *
 * Must not import the registry (kind modules import this); other kinds are reached via `ctx.kind()`.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Chip } from '@dynatrace/strato-components/content';
import { DEFAULT_SIDEBAR_WIDTH, type Item } from '../domain';
import type { KindCtx, KindModule, SidebarProps } from '../kinds/types';
import { camera } from '../layout';
import { inspect, select } from '../store';
import { agoText, TONE_CHIP } from '../tones';

const modOf = (ctx: KindCtx, item: Item) => ctx.kind(item.kind) as unknown as KindModule;

// ---- layout (provided by the shell) ------------------------------------------------------

export interface SidebarLayout {
  /** expanded to most of the window */
  wide: boolean;
  setWide: (wide: boolean) => void;
  /** current width, px */
  width: number;
}
export const SidebarLayoutContext = createContext<SidebarLayout>({ wide: false, setWide: () => {}, width: DEFAULT_SIDEBAR_WIDTH });
/** Width / expand state of the sidebar shell (e.g. a webview tab calls `setWide(true)`). */
export const useSidebarLayout = () => useContext(SidebarLayoutContext);

// ---- tabs --------------------------------------------------------------------------------

export interface SidebarTab {
  id: string;
  label: ReactNode;
  /** the tab's body; only the active tab is rendered */
  render: () => ReactNode;
  /** expand the sidebar while this tab is active (webviews, diffs) */
  wide?: boolean;
  /** small count / status next to the label */
  badge?: ReactNode;
}

const lastTab = new Map<string, string>();

/**
 * Tabs for a kind sidebar ("Details | Diff | GitHub"). The active tab is remembered per
 * `rememberAs` (e.g. the kind) while the app runs.
 *
 *   <SidebarTabs rememberAs="pr" tabs={[
 *     { id: 'details', label: 'Details', render: () => <DefaultSidebar item={item} ctx={ctx} /> },
 *     { id: 'diff', label: 'Diff', wide: true, render: () => <PrDiff pr={item} /> },
 *   ]} />
 */
export function SidebarTabs({ tabs, initial, rememberAs }: { tabs: SidebarTab[]; initial?: string; rememberAs?: string }) {
  const remembered = rememberAs ? lastTab.get(rememberAs) : undefined;
  const pick = (id?: string) => (id && tabs.some((t) => t.id === id) ? id : undefined);
  const [active, setActive] = useState(() => pick(remembered) ?? pick(initial) ?? tabs[0]?.id);
  const { setWide } = useSidebarLayout();
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const wantsWide = !!tab?.wide;
  useEffect(() => {
    if (wantsWide) setWide(true);
  }, [wantsWide, setWide]);
  if (!tab) return null;
  const choose = (id: string) => {
    setActive(id);
    if (rememberAs) lastTab.set(rememberAs, id);
    if (!tabs.find((t) => t.id === id)?.wide && wantsWide) setWide(false);
  };
  return (
    <div className="sidebar-tabs">
      <div className="sidebar-tablist" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab.id} className={`sidebar-tab ${t.id === tab.id ? 'is-active' : ''}`} onClick={() => choose(t.id)}>
            {t.label}
            {t.badge != null && <span className="sidebar-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-tabpanel" role="tabpanel">
        {tab.render()}
      </div>
    </div>
  );
}

/** A titled block of the sidebar body; `actions` (small buttons) sit on the right of the label. */
export function SidebarSection({ label, children, actions }: { label?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="sidebar-section">
      {(label || actions) && (
        <div className={`sidebar-label ${actions ? 'has-actions' : ''}`}>
          <span>{label}</span>
          {actions && <span className="sidebar-label-actions">{actions}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Title, subtitle, status chips (the ring) and the notice. */
export function SummarySection({ item, ctx }: SidebarProps) {
  const mod = modOf(ctx, item);
  const sub = mod.subtitle(item, ctx);
  const badge = mod.badge?.(item);
  return (
    <SidebarSection>
      <div className="sidebar-title">{item.title}</div>
      {sub && <div className="sidebar-sub">{sub}</div>}
      <div className="sidebar-status">
        {item.archived && (
          <Chip size="condensed" color="neutral">
            Archived
          </Chip>
        )}
        {badge && (
          <Chip size="condensed" color={TONE_CHIP[badge.tone]} variant="emphasized">
            {badge.label}
          </Chip>
        )}
        {mod.ring(item, ctx).map((s, i) => (
          <Chip key={i} size="condensed" color={TONE_CHIP[s.tone]} variant={s.tone === 'neutral' || s.tone === 'pending' ? undefined : 'emphasized'}>
            {s.label}
          </Chip>
        ))}
      </div>
      {item.notice && (
        <div className={`hover-card-notice tone-${item.notice.tone}`}>
          <span className="dot" />
          <span>{item.notice.text}</span>
          <span className="when">{agoText(item.notice.at)}</span>
        </div>
      )}
    </SidebarSection>
  );
}

/** Key / value list. */
export function FactsSection({ facts, label = 'Details' }: { facts: [string, string][]; label?: string }) {
  if (!facts.length) return null;
  return (
    <SidebarSection label={label}>
      <dl className="sidebar-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </SidebarSection>
  );
}

/** Linked items; clicking one moves the sidebar (and the camera) to it. */
export function ConnectionsSection({ item, ctx, label = 'Connections' }: SidebarProps & { label?: string }) {
  const rows = ctx.links
    .filter((l) => l.from === item.id || l.to === item.id)
    .map((l) => {
      const other = ctx.get(l.from === item.id ? l.to : l.from);
      // labels read "from → to": mark them when this item is the target
      return other ? { id: l.id, other, label: l.label, outgoing: l.from === item.id } : null;
    })
    .filter((c): c is { id: string; other: Item; label: string; outgoing: boolean } => !!c);
  if (!rows.length) return null;
  return (
    <SidebarSection label={label}>
      {rows.map((c) => (
        <button
          key={c.id}
          className="sidebar-row"
          onClick={() => {
            inspect(c.other.id);
            select([c.other.id]);
            camera.focus([c.other.id]);
          }}
        >
          <span className="sidebar-row-icon">{modOf(ctx, c.other).icon(13)}</span>
          <span className="sidebar-row-main">{c.other.title}</span>
          <span className="sidebar-row-rel">{c.outgoing ? c.label : `← ${c.label}`}</span>
        </button>
      ))}
    </SidebarSection>
  );
}

/** The generic body: summary, facts, connections. */
export function DefaultSidebar({ item, ctx }: SidebarProps) {
  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      <FactsSection facts={modOf(ctx, item).facts(item, ctx)} />
      <ConnectionsSection item={item} ctx={ctx} />
    </>
  );
}
