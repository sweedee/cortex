import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import type { AgentSession } from '../../model/types';
import { CLAUDE_DEFAULTS, modelInfo } from '../../services/config';
import { plural, subduedText } from './meta';

/** 84_000 -> "84k", 1_000_000 -> "1M", 1_250 -> "1.3k" */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

const usd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The context bar turns warning at 80 % and critical at 95 %. */
const WARN_AT = 80;
const CRITICAL_AT = 95;

function Item({ tip, children, style, optional }: { tip: ReactNode; children: ReactNode; style?: CSSProperties; optional?: boolean }) {
  return (
    <Tooltip text={tip}>
      <span className="cx-status-item" data-optional={optional || undefined} style={style} tabIndex={0}>
        {children}
      </span>
    </Tooltip>
  );
}

/** Slim one-line status of a session: model, effort, context, cost, cache, turns. */
export function StatusLine({ session }: { session: AgentSession }): ReactElement {
  const { usage } = session;
  const model = modelInfo(session.model);
  const effort = session.effort ?? CLAUDE_DEFAULTS.effort;

  const pct = usage ? Math.min(100, Math.round((usage.contextTokens / model.contextWindow) * 100)) : 0;
  const tone = pct >= CRITICAL_AT ? 'critical' : pct >= WARN_AT ? 'warning' : 'normal';
  const toneColor = tone === 'critical' ? Colors.Text.Critical.Default : tone === 'warning' ? Colors.Text.Warning.Default : undefined;
  const barColor =
    tone === 'critical' ? Colors.Icon.Critical.Default : tone === 'warning' ? Colors.Icon.Warning.Default : Colors.Icon.Primary.Default;

  const cache = usage ? usage.cacheReadTokens + usage.cacheWriteTokens : 0;
  const seen = usage ? usage.inputTokens + cache : 0;

  return (
    <div className="cx-status-wrap">
      <Text textStyle="small" className="cx-status" style={subduedText} role="status" aria-label="Session status">
        <Item tip={`Model ${session.model}, reasoning effort ${effort}. Change both in the composer between turns.`}>
          {model.label} · {effort}
        </Item>
        {usage && (
          <Item
            style={toneColor ? { color: toneColor } : undefined}
            tip={
              <>
                Context window in use: input + cache read + cache creation tokens of the latest message, out of{' '}
                {model.contextWindow.toLocaleString()}.
                {tone !== 'normal' && ' Nearly full: Claude will compact or forget older content soon, consider starting a fresh session.'}
              </>
            }
          >
            <span className="cx-ctx-bar" aria-hidden>
              <span style={{ width: `${pct}%`, background: barColor }} />
            </span>
            {pct}% · {tokens(usage.contextTokens)} / {tokens(model.contextWindow)}
          </Item>
        )}
        {usage && usage.turns > 0 && (
          <Item tip="Cost of this session so far, summed over the finished turns (USD).">{usd(usage.costUsd)}</Item>
        )}
        {usage && cache > 0 && (
          <Item
            optional
            tip="Prompt cache: tokens read from the cache (cheap) and written to it (dearer). The percentage is the share of all input tokens that came from the cache."
          >
            cache {tokens(usage.cacheReadTokens)} read / {tokens(usage.cacheWriteTokens)} write
            {seen > 0 ? ` · ${Math.round((usage.cacheReadTokens / seen) * 100)}%` : ''}
          </Item>
        )}
        {usage && usage.turns > 0 && (
          <Item optional tip="Agentic turns (model calls) in this session.">
            {plural(usage.turns, 'turn')}
          </Item>
        )}
        {usage?.lastTurnMs !== undefined && (
          <Item optional tip="How long the last turn took, without the time spent waiting for you.">
            last {duration(usage.lastTurnMs)}
          </Item>
        )}
      </Text>
    </div>
  );
}
