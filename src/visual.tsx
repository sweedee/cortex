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
import { KIND_LEVEL } from './model';

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

/** Accent tint per kind (inner glow of the bubble), in Dynatrace brand colours. */
export const KIND_ACCENT: Record<Kind, string> = {
  project: '#6F2DA8',
  ticket: '#1496FF',
  worktree: '#73BE28',
  agent: '#B455B6',
  pr: '#1284EA',
  build: '#5f6b7a',
  plan: '#00A1B2',
};


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

/**
 * Colours per item: walk links "upwards" (towards projects) and collect the roots of the
 * given kind. Items that belong to several roots get several colours; items with no
 * root (or colouring off) get none and stay gray.
 */
export function groupColors(items: Item[], links: Link[], by: 'none' | 'project' | 'ticket'): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (by === 'none') return out;
  const byId = new Map(items.map((i) => [i.id, i]));
  const up = new Map<string, string[]>();
  for (const l of links) {
    const a = byId.get(l.from),
      b = byId.get(l.to);
    if (!a || !b || KIND_LEVEL[a.kind] === KIND_LEVEL[b.kind]) continue;
    const [lo, hi] = KIND_LEVEL[a.kind] > KIND_LEVEL[b.kind] ? [a, b] : [b, a];
    up.set(lo.id, [...(up.get(lo.id) ?? []), hi.id]);
  }
  const roots = items.filter((i) => i.kind === by);
  const color = new Map(roots.map((r, i) => [r.id, GROUP_PALETTE[i % GROUP_PALETTE.length]]));
  for (const it of items) {
    const found = new Set<string>();
    const seen = new Set<string>();
    const stack = [it.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (color.has(id)) {
        found.add(id);
        continue; // stop at the root, don't climb past it
      }
      stack.push(...(up.get(id) ?? []));
    }
    // palette order, so a two-colour bubble always splits the same way
    const cs = roots.filter((r) => found.has(r.id)).map((r) => color.get(r.id)!);
    if (cs.length) out.set(it.id, cs);
  }
  return out;
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
