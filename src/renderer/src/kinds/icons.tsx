/**
 * Icons that Strato does not have (same 16px stroke style), and the icon per skill.
 * Pure: kind modules import this, so it must not import the store or the registry.
 */
import type { ReactElement } from 'react';
import {
  AiIcon,
  ChatIcon,
  CodeIcon,
  CompareIcon,
  CrosshairIcon,
  CycleIcon,
  DuplicateIcon,
  EditIcon,
  GroupItemsIcon,
  IdeaIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MarkdownIcon,
  RepairIcon,
  SorterIcon,
  UpgradeIcon,
  UploadIcon,
  ViewIcon,
  PlusIcon,
} from '@dynatrace/strato-icons';

interface P {
  size?: number;
}
const svg = (s: number | undefined, children: ReactElement | ReactElement[]) => (
  <svg width={s ?? 16} height={s ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export function PullRequestIcon({ size }: P) {
  return svg(size, [
    <circle key="a" cx="4" cy="3.5" r="1.6" />,
    <circle key="b" cx="4" cy="12.5" r="1.6" />,
    <circle key="c" cx="12" cy="12.5" r="1.6" />,
    <path key="d" d="M4 5.1v5.8M12 10.9V6.5c0-1.4-.9-2.3-2.3-2.3H7.5" />,
    <path key="e" d="M9 2.6 7.3 4.2 9 5.8" />,
  ]);
}

/** Archive box. */
export function ArchiveIcon({ size }: P) {
  return svg(size, [<rect key="a" x="1.8" y="2.5" width="12.4" height="3.2" rx="0.6" />, <path key="b" d="M2.9 5.7v6.8c0 .6.4 1 1 1h8.2c.6 0 1-.4 1-1V5.7M6.4 8.4h3.2" />]);
}

/** Rocket, for deployments. */
export function RocketIcon({ size }: P) {
  return svg(size, [
    <path key="a" d="M9.6 2.2c2-.6 3.7-.5 4.2 0s.6 2.2 0 4.2c-.6 2-2.3 3.9-4.6 5.4L6.6 9.4C8 7.1 7.6 3.4 9.6 2.2Z" />,
    <circle key="b" cx="10.6" cy="5.4" r="1.1" />,
    <path key="c" d="M6.6 9.4 4.2 8.9l1.7-2.4M9.2 11.8l.5 2.4 2.4-1.7M5.2 10.8c-1.3.3-2 1.4-2.2 3 1.6-.2 2.7-.9 3-2.2" />,
  ]);
}

/** Two ticked boxes, for todos. */
export function ChecklistIcon({ size }: P) {
  return svg(size, [
    <rect key="a" x="1.8" y="2.3" width="4" height="4" rx="0.6" />,
    <path key="b" d="m2.8 4.3 1 1 1.4-1.8" />,
    <rect key="c" x="1.8" y="9.6" width="4" height="4" rx="0.6" />,
    <path key="d" d="M8 4.3h6.2M8 11.6h6.2" />,
  ]);
}

/** Lab flask, for test runs. */
export function FlaskIcon({ size }: P) {
  return svg(size, [<path key="a" d="M6 1.8h4M6.6 1.8v4.4L2.6 12.6c-.5.9.1 1.8 1.1 1.8h8.6c1 0 1.6-.9 1.1-1.8L9.4 6.2V1.8" />, <path key="b" d="M4.4 10h7.2" />]);
}

/**
 * Icon per skill, by what it does rather than "it's AI". The AI icon is kept for skills
 * that are mainly about the model's judgement (explaining, summarising) and as fallback.
 */
const SKILL_ICONS: Record<string, () => ReactElement> = {
  'plan-ticket': () => <ListIcon />,
  'plan-feature': () => <GroupItemsIcon />,
  'create-ticket': () => <PlusIcon />,
  brainstorm: () => <IdeaIcon />,
  'write-plan': () => <ListIcon />,
  implement: () => <CodeIcon />,
  'implement-plan': () => <CodeIcon />,
  'self-review': () => <ViewIcon />,
  'review-worktree': () => <ViewIcon />,
  'review-pr': () => <MagnifyingGlassIcon />,
  'create-pr': () => <UploadIcon />,
  'address-review': () => <ChatIcon />,
  'resolve-conflicts': () => <CompareIcon />,
  rebase: () => <CycleIcon />,
  'fix-ci': () => <RepairIcon />,
  'fix-tests': () => <RepairIcon />,
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
