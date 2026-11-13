/**
 * Building blocks of the details sidebar. The shell (header with kind, handle and close
 * button) is `overlays/Sidebar.tsx`; the body is the kind's `Sidebar` component, or
 * `DefaultSidebar`. Kind sidebars compose these sections plus their own.
 *
 * Must not import the registry (kind modules import this); other kinds are reached via `ctx.kind()`.
 */
import type { ReactNode } from 'react';
import { Chip } from '@dynatrace/strato-components/content';
import type { Item } from '../domain';
import type { KindCtx, KindModule, SidebarProps } from '../kinds/types';
import { camera } from '../layout';
import { inspect, select } from '../store';
import { agoText, TONE_CHIP } from '../tones';

const modOf = (ctx: KindCtx, item: Item) => ctx.kind(item.kind) as unknown as KindModule;

/** A titled block of the sidebar body. */
export function SidebarSection({ label, children, actions }: { label?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="sidebar-section">
      {(label || actions) && (
        <div className="sidebar-label">
          {label}
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
