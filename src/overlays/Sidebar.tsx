/**
 * Right-hand details panel for one bubble, opened by double-clicking it. General
 * details only (status, facts, connections); actions stay in the floating list.
 */
import { Chip } from '@dynatrace/strato-components/content';
import { XmarkIcon } from '@dynatrace/strato-icons';
import { camera } from '../layout';
import { KIND_LABEL, type Item } from '../model';
import { inspect, select, useStore } from '../store';
import { KIND_ICON, TONE_CHIP } from '../visual';

export const SIDEBAR_W = 320;
const ago = (m: number) => (m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`);

export function Sidebar() {
  const inspected = useStore((s) => s.inspected);
  const items = useStore((s) => s.items);
  const links = useStore((s) => s.links);

  const item = inspected ? items.find((i) => i.id === inspected) : undefined;
  if (!item) return null;

  const byId = new Map(items.map((i) => [i.id, i]));
  const connections = links
    .filter((l) => l.from === item.id || l.to === item.id)
    .map((l) => {
      const other = byId.get(l.from === item.id ? l.to : l.from);
      // labels read "from → to": mark them when this item is the target
      return other ? { id: l.id, other, label: l.label, outgoing: l.from === item.id } : null;
    })
    .filter((c): c is { id: string; other: Item; label: string; outgoing: boolean } => !!c);

  return (
    <aside className="sidebar" key={item.id} style={{ width: SIDEBAR_W }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${KIND_LABEL[item.kind]} details`}>
      <header className="sidebar-head">
        <span className="sidebar-kind">
          {KIND_ICON[item.kind](14)}
          <span>{KIND_LABEL[item.kind]}</span>
        </span>
        <span className="sidebar-handle">@{item.handle}</span>
        <button className="sidebar-close" onClick={() => inspect(null)} aria-label="Close details (Esc)">
          <XmarkIcon />
        </button>
      </header>

      <div className="sidebar-body">
        <section className="sidebar-section">
          <div className="sidebar-title">{item.title}</div>
          {item.subtitle && <div className="sidebar-sub">{item.subtitle}</div>}
          <div className="sidebar-status">
            {item.status.map((s, i) => (
              <Chip key={i} size="condensed" color={TONE_CHIP[s.tone]} variant={s.tone === 'neutral' || s.tone === 'pending' ? undefined : 'emphasized'}>
                {s.label}
              </Chip>
            ))}
          </div>
          {item.notice && (
            <div className={`hover-card-notice tone-${item.notice.tone}`}>
              <span className="dot" />
              <span>{item.notice.text}</span>
              <span className="when">{ago(item.notice.ago)}</span>
            </div>
          )}
        </section>

        {item.facts && (
          <section className="sidebar-section">
            <div className="sidebar-label">Details</div>
            <dl className="sidebar-facts">
              {item.facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {connections.length > 0 && (
          <section className="sidebar-section">
            <div className="sidebar-label">Connections</div>
            {connections.map((c) => (
              <button
                key={c.id}
                className="sidebar-row"
                onClick={() => {
                  inspect(c.other.id);
                  select([c.other.id]);
                  camera.focus([c.other.id]);
                }}
              >
                <span className="sidebar-row-icon">{KIND_ICON[c.other.kind](13)}</span>
                <span className="sidebar-row-main">{c.other.title}</span>
                <span className="sidebar-row-rel">{c.outgoing ? c.label : `← ${c.label}`}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
