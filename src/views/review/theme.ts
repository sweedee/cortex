import type { CSSProperties } from 'react';
import Borders from '@dynatrace/strato-design-tokens/borders';
import BoxShadows from '@dynatrace/strato-design-tokens/box-shadows';
import Colors from '@dynatrace/strato-design-tokens/colors';
import Typography from '@dynatrace/strato-design-tokens/typography';

/**
 * Strato tokens exposed as custom properties for review.css. The token values
 * are themselves `var(--dt-…)` references, so light/dark theming keeps working.
 */
export const themeVars = {
  '--rv-font': Typography.Text.Base.Default.Family,
  '--rv-mono': Typography.Code.Small.Default.Family,

  '--rv-base': Colors.Background.Base.Default,
  '--rv-surface': Colors.Background.Surface.Default,
  '--rv-head': Colors.Background.Container.Neutral.Subdued,
  '--rv-gutter': Colors.Background.Container.Neutral.Subdued,
  '--rv-hunk': Colors.Background.Container.Primary.Default,
  '--rv-hover': Colors.Background.Field.Neutral.DefaultHover,
  '--rv-neutral-bg': Colors.Background.Container.Neutral.Default,
  '--rv-neutral-bg-strong': Colors.Theme.Neutral[40],
  '--rv-primary-bg': Colors.Background.Container.Primary.Emphasized,
  '--rv-primary-accent': Colors.Background.Container.Primary.Accent,
  '--rv-warning-accent': Colors.Background.Container.Warning.Accent,
  '--rv-on-accent': Colors.Text.Primary.OnAccent.Default,

  '--rv-text': Colors.Text.Neutral.Default,
  '--rv-text-subdued': Colors.Text.Neutral.Subdued,
  '--rv-primary': Colors.Text.Primary.Default,
  '--rv-success': Colors.Text.Success.Default,
  '--rv-critical': Colors.Text.Critical.Default,
  '--rv-warning': Colors.Text.Warning.Default,

  '--rv-border': Colors.Border.Neutral.Default,
  '--rv-border-subdued': Colors.Border.Neutral.Subdued,
  '--rv-border-accent': Colors.Border.Neutral.Accent,

  '--rv-add-line': Colors.Theme.Success[20],
  '--rv-add-gutter': Colors.Theme.Success[40],
  '--rv-del-line': Colors.Theme.Critical[20],
  '--rv-del-gutter': Colors.Theme.Critical[40],

  '--rv-syn-comment': Colors.Syntax.Comment,
  '--rv-syn-string': Colors.Syntax.String,
  '--rv-syn-number': Colors.Syntax.Number,
  '--rv-syn-keyword': Colors.Syntax.Operators,
  '--rv-syn-literal': Colors.Syntax.Boolean,
  '--rv-syn-function': Colors.Syntax.Function,
  '--rv-syn-meta': Colors.Syntax.Tag,

  '--rv-radius': Borders.Radius.Container.Subdued,
  '--rv-radius-s': Borders.Radius.Field.Subdued,
  '--rv-shadow': BoxShadows.Surface.Raised.Rest,
} as CSSProperties;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const min = Math.round((Date.now() - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
