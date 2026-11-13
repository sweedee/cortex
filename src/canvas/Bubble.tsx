import { memo } from 'react';
import type { Item, Segment } from '../model';
import { KIND_RADIUS } from '../model';
import { KIND_ACCENT, KIND_ICON, TONE_COLOR } from '../visual';

export interface BubbleProps {
  item: Item;
  x: number;
  y: number;
  selected: boolean;
  /** related to hover/selection, or mentioned in the chat box */
  lit: boolean;
  /** something else is focused and this one is not related */
  dimmed: boolean;
  mentioned: boolean;
  isNew: boolean;
}

const RING_W = 3.5;
const GAP = 5; // px gap between ring segments

function Ring({ r, segments }: { r: number; segments: Segment[] }) {
  const R = r + 4;
  const C = 2 * Math.PI * R;
  const total = segments.reduce((s, x) => s + (x.weight ?? 1), 0);
  const gaps = segments.length > 1 ? segments.length * GAP : 0;
  let offset = 0;
  const running = segments.some((s) => s.tone === 'running');
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
      {running && (
        <g className="ring-comet" style={{ transformOrigin: `${c}px ${c}px` }}>
          <circle cx={c} cy={c} r={R} fill="none" stroke="#7cc4ff" strokeWidth={RING_W + 1.5} strokeLinecap="round" strokeDasharray={`${C * 0.22} ${C}`} />
        </g>
      )}
    </svg>
  );
}

export const Bubble = memo(function Bubble({ item, x, y, selected, lit, dimmed, mentioned, isNew }: BubbleProps) {
  const r = KIND_RADIUS[item.kind];
  const accent = KIND_ACCENT[item.kind];
  const tone = item.status[0]?.tone;
  const waiting = item.flags?.waitingForInput;
  const cls = [
    'bubble',
    `kind-${item.kind}`,
    selected && 'is-selected',
    lit && 'is-lit',
    dimmed && 'is-dimmed',
    mentioned && 'is-mentioned',
    waiting && 'is-waiting',
    tone === 'critical' && 'is-critical',
    isNew && 'is-new',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-id={item.id}
      style={{ transform: `translate(${x - r}px, ${y - r}px)`, width: r * 2, height: r * 2, ['--accent' as string]: accent, ['--tone' as string]: TONE_COLOR[tone ?? 'neutral'] }}
    >
      <div className="bubble-float">
        <div className="bubble-disc">
          <span className="bubble-icon">{KIND_ICON[item.kind](item.kind === 'project' ? 22 : item.kind === 'build' || item.kind === 'plan' ? 14 : 16)}</span>
          {item.kind === 'project' ? (
            <span className="bubble-short bubble-short-project">{item.title}</span>
          ) : (
            item.short && <span className="bubble-short">{item.short}</span>
          )}
        </div>
        <Ring r={r} segments={item.status} />
        {item.notice && (
          <span className={`bubble-notice tone-${item.notice.tone}`} style={{ left: r + r * 0.7071 - 7, top: r - r * 0.7071 - 7 }}>
            <span className="bubble-notice-pulse" />
          </span>
        )}
        {item.kind !== 'project' && (
          <div className="bubble-caption" style={{ top: r * 2 + 10 }}>
            <span className="bubble-title">{item.title}</span>
          </div>
        )}
      </div>
    </div>
  );
});
