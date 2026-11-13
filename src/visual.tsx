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
import type { Kind, Tone } from './model';

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
