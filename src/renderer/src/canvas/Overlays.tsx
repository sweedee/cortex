/** Screen-space overlays on top of the canvas: hover card and inline quick actions. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ChevronLeftSmallIcon, ChevronRightSmallIcon } from '@dynatrace/strato-icons';
import { Chip } from '@dynatrace/strato-components/content';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import type { Item } from '../domain';
import { actionsForItem, type Action } from '../actions';
import { ArchiveIcon } from '../kinds/icons';
import { factsOf, kindIcon, kindLabel, useCtx, useViews } from '../kinds/registry';
import { select } from '../store';
import { agoText, TONE_CHIP } from '../tones';
import { accentOf, NEUTRAL_ACCENT, stripes, useItemColors } from '../visual';

export function HoverCard({ item, x, y, flip }: { item: Item; x: number; y: number; flip: boolean }) {
  const colors = useItemColors();
  const view = useViews().get(item.id);
  const ctx = useCtx();
  const facts = factsOf(item, ctx);
  return (
    <div className={`hover-card ${flip ? 'is-flipped' : ''}`} style={{ left: x, top: y, ['--accent' as string]: stripes(colors.get(item.id) ?? [NEUTRAL_ACCENT], 180) }}>
      <div className="hover-card-kind">
        {kindIcon(item.kind, 14)}
        <span>{kindLabel(item.kind)}</span>
        {item.archived && (
          <span className="archived-tag">
            <ArchiveIcon size={12} /> archived
          </span>
        )}
        <span className="hover-card-handle">@{item.handle}</span>
      </div>
      <div className="hover-card-title">{item.title}</div>
      {view?.subtitle && <div className="hover-card-sub">{view.subtitle}</div>}
      <div className="hover-card-status">
        {view?.badge && (
          <Chip size="condensed" color={TONE_CHIP[view.badge.tone]} variant="emphasized">
            {view.badge.label}
          </Chip>
        )}
        {view?.ring.map((s, i) => (
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
      {facts.length > 0 && (
        <dl className="hover-card-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The vertical action list that appears beside a selected bubble (or a multi-selection).
 * Below the actions: the linked items, each with its own actions in a flyout on hover.
 */
export function InlineActions({
  actions,
  items,
  related,
  colors,
  x,
  y,
  flip,
}: {
  actions: Action[];
  items: Item[];
  related: Item[];
  colors: Map<string, string[]>;
  x: number;
  y: number;
  flip: boolean;
}) {
  const [open, setOpen] = useState<{ id: string; up: boolean } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const openRow = (id: string, el: HTMLElement) => {
    clearTimeout(timer.current);
    // flyouts of rows in the lower part of the screen open upwards
    setOpen({ id, up: el.getBoundingClientRect().top > window.innerHeight * 0.55 });
  };
  const closeSoon = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(null), 180);
  };
  return (
    <div className={`inline-actions ${flip ? 'is-flipped' : ''}`} style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      {items.length > 1 && <span className="inline-actions-count">{items.length} selected</span>}
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} items={items} placement={flip ? 'left' : 'right'} />
      ))}
      {related.length > 0 && <span className="inline-actions-section">Related</span>}
      {related.map((r) => {
        const isOpen = open?.id === r.id;
        return (
          <div key={r.id} className="rel-wrap" onMouseEnter={(e) => openRow(r.id, e.currentTarget)} onMouseLeave={closeSoon}>
            <button
              className={`rel-row ${isOpen ? 'is-open' : ''}`}
              onClick={() => select([r.id])}
              onFocus={(e) => openRow(r.id, e.currentTarget)}
              title={`Select ${r.title}`}
            >
              {flip && <ChevronLeftSmallIcon />}
              <span className="rel-row-icon" style={{ ['--accent' as string]: accentOf(colors, r.id) }}>
                {kindIcon(r.kind, 12)}
              </span>
              <span className="rel-row-handle">{r.handle}</span>
              {!flip && <ChevronRightSmallIcon />}
            </button>
            {isOpen && (
              <div className={`rel-flyout ${flip ? 'is-flipped' : ''} ${open.up ? 'is-up' : ''}`}>
                <span className="rel-flyout-title">
                  {kindIcon(r.kind, 12)}
                  <span>{r.title}</span>
                </span>
                {actionsForItem(r).map((a) => (
                  <ActionButton key={a.id} action={a} items={[r]} placement={flip ? 'left' : 'right'} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ActionButton({ action: a, items, size = 'condensed', placement }: { action: Action; items: Item[]; size?: 'condensed' | 'default'; placement?: 'left' | 'right' }) {
  const btn = (
    <Button
      size={size}
      variant={a.primary && !a.disabled ? 'accent' : 'default'}
      color={a.danger ? 'critical' : a.primary && !a.disabled ? 'primary' : 'neutral'}
      disabled={!!a.disabled}
      onClick={() => a.run(items)}
      className={`action-btn action-${a.type}`}
    >
      <Button.Prefix>{a.icon}</Button.Prefix>
      {a.label}
    </Button>
  );
  const tip = a.disabled ?? (a.type === 'skill' && a.skill ? `Inserts /${a.skill} into the chat box` : undefined);
  if (!tip) return btn;
  return (
    <Tooltip text={tip} placement={placement}>
      {/* span so the tooltip also works on a disabled button */}
      <span className="action-tip-wrap">{btn}</span>
    </Tooltip>
  );
}
