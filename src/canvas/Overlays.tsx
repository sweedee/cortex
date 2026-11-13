/** Screen-space overlays on top of the canvas: hover card and inline quick actions. */
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import type { Item } from '../model';
import { KIND_LABEL } from '../model';
import type { Action } from '../actions';
import { KIND_ACCENT, KIND_ICON, TONE_CHIP } from '../visual';

const ago = (m: number) => (m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`);

export function HoverCard({ item, x, y, flip }: { item: Item; x: number; y: number; flip: boolean }) {
  return (
    <div className={`hover-card ${flip ? 'is-flipped' : ''}`} style={{ left: x, top: y, ['--accent' as string]: KIND_ACCENT[item.kind] }}>
      <div className="hover-card-kind">
        {KIND_ICON[item.kind](14)}
        <span>{KIND_LABEL[item.kind]}</span>
        <span className="hover-card-handle">@{item.handle}</span>
      </div>
      <div className="hover-card-title">{item.title}</div>
      {item.subtitle && <div className="hover-card-sub">{item.subtitle}</div>}
      <div className="hover-card-status">
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
      {item.facts && (
        <dl className="hover-card-facts">
          {item.facts.map(([k, v]) => (
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

/** The vertical action list that appears beside a selected bubble (or a multi-selection). */
export function InlineActions({ actions, items, x, y, flip }: { actions: Action[]; items: Item[]; x: number; y: number; flip: boolean }) {
  return (
    <div className={`inline-actions ${flip ? 'is-flipped' : ''}`} style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      {items.length > 1 && <span className="inline-actions-count">{items.length} selected</span>}
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} items={items} placement={flip ? 'left' : 'right'} />
      ))}
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
