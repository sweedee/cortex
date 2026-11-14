/**
 * The status bar's numbers from a session's usage (pure, tested in `usage.test.ts`): context
 * meter, token totals, cache hit rates, cost, turns, time; and the subagent tally.
 */
import type { SessionUsage, SubagentInfo } from '../../../../shared/integrations/claude';

/** Claude Code's default window, used until the CLI reports the real one with the first result. */
export const DEFAULT_WINDOW = 200_000;

export interface UsageView {
  contextTokens: number;
  contextWindow: number;
  /** the window is a guess (no result yet) */
  windowGuessed: boolean;
  contextPct: number;
  tone: 'normal' | 'warning' | 'critical';
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** share of the latest call's prompt read from the cache (undefined = no call yet) */
  lastHitPct?: number;
  /** share of all prompt tokens read from the cache */
  totalHitPct?: number;
  costUsd: number;
  turns: number;
  durationMs: number;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : undefined);

/** context bar tone: warning from 80 %, critical from 95 % */
export const contextTone = (p: number): UsageView['tone'] => (p >= 95 ? 'critical' : p >= 80 ? 'warning' : 'normal');

export function usageView(u: SessionUsage): UsageView {
  const window = u.contextWindow || DEFAULT_WINDOW;
  const contextPct = Math.min(100, Math.round((u.contextTokens / window) * 100));
  const last = u.last;
  return {
    contextTokens: u.contextTokens,
    contextWindow: window,
    windowGuessed: !u.contextWindow,
    contextPct,
    tone: contextTone(contextPct),
    input: u.inputTokens,
    output: u.outputTokens,
    cacheRead: u.cacheReadTokens,
    cacheWrite: u.cacheWriteTokens,
    lastHitPct: last ? pct(last.cacheRead, last.input + last.cacheRead + last.cacheWrite) : undefined,
    totalHitPct: pct(u.cacheReadTokens, u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens),
    costUsd: u.costUsd,
    turns: u.turns,
    durationMs: u.durationMs ?? 0,
  };
}

/** 84_000 → "84k", 1_250 → "1.3k", 1_000_000 → "1M" */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** 3_400 → "3.4s", 125_000 → "2m 5s", 4_000_000 → "1h 6m" */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (ms < 10_000) return `${+(ms / 1000).toFixed(1)}s`;
  if (s < 3600) return `${Math.floor(s / 60) ? `${Math.floor(s / 60)}m ` : ''}${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const usd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);

/** "2 running · 3 done" etc. */
export function subagentTally(subs: SubagentInfo[]): { running: number; done: number; failed: number; total: number; text: string } {
  const running = subs.filter((s) => s.status === 'running').length;
  const failed = subs.filter((s) => s.status === 'failed' || s.status === 'stopped').length;
  const done = subs.length - running - failed;
  const parts = [running && `${running} running`, done && `${done} done`, failed && `${failed} failed`].filter(Boolean);
  return { running, done, failed, total: subs.length, text: parts.join(' · ') };
}
