/**
 * Right-hand context panel for the current selection: details, status, actions and
 * connections. Replaces the floating action list that used to sit next to a bubble.
 */
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { ChatIcon, DeleteIcon, XmarkIcon, ZoomToFitIcon } from '@dynatrace/strato-icons';
import { actionsForSelection } from '../actions';
import { ActionButton } from '../canvas/Overlays';
import { camera } from '../layout';
import { KIND_LABEL, type Item } from '../model';
import { insertSkill, removeItems, select, useStore } from '../store';
import { KIND_ACCENT, KIND_ICON, TONE_CHIP } from '../visual';

export const SIDEBAR_W = 320;
const ago = (m: number) => (m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`);

export function Sidebar() {
  const selected = useStore((s) => s.selected);
  const items = useStore((s) => s.items);
  const links = useStore((s) => s.links);
  const hiddenKinds = useStore((s) => s.hiddenKinds);

  const visible = selected.filter((id) => {
    const it = items.find((i) => i.id === id);
    return it && !hiddenKinds.includes(it.kind);
  });
  const sel = actionsForSelection(visible);
  if (sel.items.length === 0) return null;

  const single = sel.items.length === 1 ? sel.items[0] : null;
  const ids = sel.items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const connections = single
    ? links
        .filter((l) => l.from === single.id || l.to === single.id)
        .map((l) => {
          const other = byId.get(l.from === single.id ? l.to : l.from);
          // labels read "from → to": invert the wording when this item is the target
          return other ? { id: l.id, other, label: l.label, outgoing: l.from === single.id } : null;
        })
        .filter((c): c is { id: string; other: Item; label: string; outgoing: boolean } => !!c)
    : [];

  return (
    <aside
      className="sidebar"
      key={single ? single.id : 'multi'}
      style={{ width: SIDEBAR_W, ['--accent' as string]: single ? KIND_ACCENT[single.kind] : 'var(--tone-primary)' }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Selection details"
    >
      <header className="sidebar-head">
        {single ? (
          <>
            <span className="sidebar-kind">
              {KIND_ICON[single.kind](14)}
              <span>{KIND_LABEL[single.kind]}</span>
            </span>
            <span className="sidebar-handle">@{single.handle}</span>
          </>
        ) : (
          <span className="sidebar-kind">{sel.items.length} selected</span>
        )}
        <button className="sidebar-close" onClick={() => select([])} aria-label="Close panel (Esc)">
          <XmarkIcon />
        </button>
      </header>

      <div className="sidebar-body">
        {single ? (
          <section className="sidebar-section">
            <div className="sidebar-title">{single.title}</div>
            {single.subtitle && <div className="sidebar-sub">{single.subtitle}</div>}
            <div className="sidebar-status">
              {single.status.map((s, i) => (
                <Chip key={i} size="condensed" color={TONE_CHIP[s.tone]} variant={s.tone === 'neutral' || s.tone === 'pending' ? undefined : 'emphasized'}>
                  {s.label}
                </Chip>
              ))}
            </div>
            {single.notice && (
              <div className={`hover-card-notice tone-${single.notice.tone}`}>
                <span className="dot" />
                <span>{single.notice.text}</span>
                <span className="when">{ago(single.notice.ago)}</span>
              </div>
            )}
            {single.facts && (
              <dl className="hover-card-facts">
                {single.facts.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ) : (
          <section className="sidebar-section sidebar-picked">
            {sel.items.map((i) => (
              <button key={i.id} className="sidebar-row" style={{ ['--accent' as string]: KIND_ACCENT[i.kind] }} onClick={() => select([i.id])}>
                <span className="sidebar-row-icon">{KIND_ICON[i.kind](13)}</span>
                <span className="sidebar-row-main">{i.title}</span>
              </button>
            ))}
          </section>
        )}

        {sel.actions.length > 0 && (
          <section className="sidebar-section">
            <div className="sidebar-label">Actions</div>
            <div className="sidebar-actions">
              {sel.actions.map((a) => (
                <ActionButton key={a.id} action={a} items={sel.items} placement="left" />
              ))}
            </div>
          </section>
        )}

        {connections.length > 0 && (
          <section className="sidebar-section">
            <div className="sidebar-label">Connections</div>
            {connections.map((c) => (
              <button
                key={c.id}
                className="sidebar-row"
                style={{ ['--accent' as string]: KIND_ACCENT[c.other.kind] }}
                onClick={() => {
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

      <footer className="sidebar-foot">
        <Button size="condensed" onClick={() => insertSkill(null, ids)}>
          <Button.Prefix>
            <ChatIcon />
          </Button.Prefix>
          Mention
        </Button>
        <Button size="condensed" onClick={() => camera.focus(ids)}>
          <Button.Prefix>
            <ZoomToFitIcon />
          </Button.Prefix>
          Zoom to
        </Button>
        <Button size="condensed" color="critical" onClick={() => removeItems(ids)} aria-label="Remove from canvas">
          <Button.Prefix>
            <DeleteIcon />
          </Button.Prefix>
        </Button>
      </footer>
    </aside>
  );
}
