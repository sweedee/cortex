/** Visual vocabulary: tone colours, kind icons and accents. */
import type { ReactElement } from 'react';
import {
  AgentIcon,
  AiIcon,
  ChatIcon,
  CodeIcon,
  CompareIcon,
  CrosshairIcon,
  DescriptionIcon,
  DuplicateIcon,
  EditIcon,
  EpicIcon,
  FlowIcon,
  GroupItemsIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MarkdownIcon,
  RepairIcon,
  SorterIcon,
  UpgradeIcon,
  UploadIcon,
  ViewIcon,
  WorkflowIcon,
} from '@dynatrace/strato-icons';
import type { Item, Kind, Link, Tone } from './model';
import { rootsOf } from './model';
import { useStore, type ColorBy, type State } from './store';

/** CSS colours (Strato tokens where one fits, Dynatrace brand colours otherwise). */
export const TONE_COLOR: Record<Tone, string> = {
  success: 'var(--tone-success)',
  warning: 'var(--tone-warning)',
  critical: 'var(--tone-critical)',
  running: 'var(--tone-running)',
  primary: 'var(--tone-primary)',
  pending: 'var(--tone-pending)',
  neutral: 'var(--tone-neutral)',
};

export const TONE_CHIP: Record<Tone, 'neutral' | 'primary' | 'success' | 'warning' | 'critical'> = {
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  running: 'primary',
  primary: 'primary',
  pending: 'neutral',
  neutral: 'neutral',
};

export const TONE_TOAST: Record<Tone, 'info' | 'warning' | 'critical' | 'success'> = {
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  running: 'info',
  primary: 'info',
  pending: 'info',
  neutral: 'info',
};

/** Pull request icon is not in Strato icons; a small inline one in the same style. */
function PullRequestIcon(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      <circle cx="4" cy="3.5" r="1.6" />
      <circle cx="4" cy="12.5" r="1.6" />
      <circle cx="12" cy="12.5" r="1.6" />
      <path d="M4 5.1v5.8M12 10.9V6.5c0-1.4-.9-2.3-2.3-2.3H7.5" />
      <path d="M9 2.6 7.3 4.2 9 5.8" />
    </svg>
  );
}

export const KIND_ICON: Record<Kind, (size?: number) => ReactElement> = {
  project: (s) => <WorkflowIcon size={s} />,
  ticket: (s) => <EpicIcon size={s} />,
  worktree: (s) => <FlowIcon size={s} />,
  agent: (s) => <AgentIcon size={s} />,
  pr: (s) => <PullRequestIcon size={s} />,
  build: (s) => <RepairIcon size={s} />,
  plan: (s) => <DescriptionIcon size={s} />,
};

/** Archive box; Strato icons have none. Same stroke style as the PR icon. */
export function ArchiveIcon(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      <rect x="1.8" y="2.5" width="12.4" height="3.2" rx="0.6" />
      <path d="M2.9 5.7v6.8c0 .6.4 1 1 1h8.2c.6 0 1-.4 1-1V5.7M6.4 8.4h3.2" />
    </svg>
  );
}

/**
 * Icon per skill, by what it does rather than "it's AI". The AI icon is kept for skills
 * that are mainly about the model's judgement (explaining, summarising) and as fallback.
 */
const SKILL_ICONS: Record<string, () => ReactElement> = {
  'plan-ticket': () => <ListIcon />,
  'plan-feature': () => <GroupItemsIcon />,
  implement: () => <CodeIcon />,
  'implement-plan': () => <CodeIcon />,
  'self-review': () => <ViewIcon />,
  'review-pr': () => <MagnifyingGlassIcon />,
  'create-pr': () => <UploadIcon />,
  'address-review': () => <ChatIcon />,
  'resolve-conflicts': () => <CompareIcon />,
  'fix-ci': () => <RepairIcon />,
  'explain-build': () => <AiIcon />,
  'grill-plan': () => <CrosshairIcon />,
  'refine-ticket': () => <EditIcon />,
  'triage-tickets': () => <SorterIcon />,
  'review-renovate': () => <UpgradeIcon />,
  'describe-pr': () => <MarkdownIcon />,
  'status-summary': () => <AiIcon />,
  'continue-session': () => <ChatIcon />,
  'fork-session': () => <DuplicateIcon />,
};
export const skillIcon = (name: string) => (SKILL_ICONS[name] ?? (() => <AiIcon />))();

/** Group colours, muted enough to sit on the dark canvas without shouting. */
const GROUP_PALETTE = ['#4aa8ff', '#c27ad0', '#7fc24a', '#e0a33c', '#2bb5c4', '#e8697a', '#9a8cff', '#c9c94a'];

/** Colour of items without a group (colouring off, or no project/ticket above them). */
export const NEUTRAL_ACCENT = '#8a90a8';

/**
 * Colours per item from the project/ticket roots it rolls up to. Items that belong to
 * several roots get several colours; items with no root (or colouring off) get none.
 */
export function groupColors(items: Item[], links: Link[], by: 'none' | 'project' | 'ticket'): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (by === 'none') return out;
  const roots = items.filter((i) => i.kind === by);
  const color = new Map(roots.map((r, i) => [r.id, GROUP_PALETTE[i % GROUP_PALETTE.length]]));
  const order = new Map(roots.map((r, i) => [r.id, i]));
  rootsOf(items, links, by).forEach((rs, id) => {
    // palette order, so a two-colour bubble always splits the same way
    out.set(id, [...rs].sort((a, b) => order.get(a)! - order.get(b)!).map((r) => color.get(r)!));
  });
  return out;
}

let colorCache: { items: Item[]; links: Link[]; by: ColorBy; map: Map<string, string[]> } | null = null;
const colorsOf = (s: State) => {
  if (!colorCache || colorCache.items !== s.items || colorCache.links !== s.links || colorCache.by !== s.colorBy)
    colorCache = { items: s.items, links: s.links, by: s.colorBy, map: groupColors(s.items, s.links, s.colorBy) };
  return colorCache.map;
};
/** The group colours of every item, the one colour system used everywhere in the UI. */
export const useItemColors = () => useStore(colorsOf);
/** Main accent of one item (first group colour or neutral gray). */
export const accentOf = (colors: Map<string, string[]>, id: string) => colors.get(id)?.[0] ?? NEUTRAL_ACCENT;

/** Hard-edged slices of the given colours along a line (for borders and strips), no blending. */
export function stripes(colors: string[], angle = 90): string {
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  return `linear-gradient(${angle}deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

/** Disc fill for one or more group colours: flat slices with hard edges, no blending. */
export function groupFill(colors: string[] | undefined): string | undefined {
  if (!colors?.length) return undefined;
  const tint = (c: string) => `color-mix(in srgb, ${c} 30%, var(--surface-raised))`;
  if (colors.length === 1) return tint(colors[0]);
  const step = 360 / colors.length;
  const stops = colors.map((c, i) => `${tint(c)} ${i * step}deg ${(i + 1) * step}deg`).join(', ');
  return `conic-gradient(${stops})`;
}
