import { memo } from 'react';
import type { Item, Segment } from '../domain';
import { getKind, type ItemView } from '../kinds/registry';
import { TONE_COLOR } from '../tones';

export interface BubbleProps {
  item: Item;
  /** ring, short text, badge… derived by the kind module (same object until the item changes) */
  view: ItemView;
  x: number;
  y: number;
  selected: boolean;
  /** related to hover/selection, or mentioned in the chat box */
  lit: boolean;
  /** something else is focused and this one is not related */
  dimmed: boolean;
  mentioned: boolean;
  /** matches the @-query being typed in the chat box */
  hit: boolean;
  /** the match under the keyboard cursor of the mention popup */
  hitActive: boolean;
  isNew: boolean;
  /** the item's group colour (mention outline) */
  accent: string;
  /** disc fill from the group colours (related items share them); unset = neutral gray */
  fill?: string;
}

const RING_W = 3.5;
const GAP = 5; // px gap between ring segments

function Ring({ r, segments }: { r: number; segments: Segment[] }) {
  const R = r + 4;
  const C = 2 * Math.PI * R;
  const total = segments.reduce((s, x) => s + (x.weight ?? 1), 0);
  const gaps = segments.length > 1 ? segments.length * GAP : 0;
  let offset = 0;
  const size = (R + RING_W + 4) * 2;
  const c = size / 2;
  return (
    <svg className="bubble-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ left: -(c - r), top: -(c - r) }} aria-hidden>
      <circle cx={c} cy={c} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={RING_W} />
      <g transform={`rotate(-90 ${c} ${c})`}>
        {segments.map((s, i) => {
          const len = ((C - gaps) * (s.weight ?? 1)) / total;
          const el = (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={R}
              fill="none"
              stroke={TONE_COLOR[s.tone]}
              strokeWidth={RING_W}
              strokeLinecap={segments.length > 1 ? 'round' : 'butt'}
              strokeDasharray={`${Math.max(len - (segments.length > 1 ? RING_W : 0), 0.1)} ${C}`}
              strokeDashoffset={-offset}
              className={s.tone === 'running' ? 'seg-running' : undefined}
            />
          );
          offset += len + (segments.length > 1 ? GAP : 0);
          return el;
        })}
      </g>
    </svg>
  );
}

/** icon size inside the disc, by bubble size */
const iconSize = (r: number) => (r >= 50 ? 28 : r <= 28 ? 18 : 22);

export const Bubble = memo(function Bubble({ item, view, x, y, selected, lit, dimmed, mentioned, hit, hitActive, isNew, fill, accent }: BubbleProps) {
  const mod = getKind(item.kind);
  const r = mod.radius;
  const tone = view.ring[0]?.tone;
  const cls = [
    'bubble',
    `kind-${item.kind}`,
    selected && 'is-selected',
    lit && 'is-lit',
    dimmed && 'is-dimmed',
    mentioned && 'is-mentioned',
    hit && 'is-hit',
    hitActive && 'is-hit-active',
    item.archived && 'is-archived',
    view.waiting && 'is-waiting',
    tone === 'critical' && 'is-critical',
    isNew && 'is-new',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-id={item.id}
      style={{ transform: `translate(${x - r}px, ${y - r}px)`, width: r * 2, height: r * 2, ['--tone' as string]: TONE_COLOR[tone ?? 'neutral'], ['--accent' as string]: accent }}
    >
      <div className="bubble-float">
        <div className="bubble-disc" style={fill ? { background: fill } : undefined}>
          <span className="bubble-icon">{mod.icon(iconSize(r))}</span>
          {mod.titleInside ? (
            <span className="bubble-short bubble-short-project">{item.title}</span>
          ) : (
            view.short && <span className={`bubble-short ${r <= 28 ? 'is-small' : ''}`}>{view.short}</span>
          )}
        </div>
        <Ring r={r} segments={view.ring} />
        {view.badge && (
          <span className={`bubble-badge tone-${view.badge.tone}`} style={{ top: r * 2 - 2 }}>
            {view.badge.label}
          </span>
        )}
        {item.notice && !item.notice.read && !item.archived && (
          <span className={`bubble-notice tone-${item.notice.tone}`} style={{ left: r + r * 0.7071 - 7, top: r - r * 0.7071 - 7 }}>
            <span className="bubble-notice-pulse" />
          </span>
        )}
        {!mod.titleInside && (
          <div className="bubble-caption" style={{ top: r * 2 + (view.badge ? 20 : 10) }}>
            <span className="bubble-title">{item.title}</span>
          </div>
        )}
      </div>
    </div>
  );
});
