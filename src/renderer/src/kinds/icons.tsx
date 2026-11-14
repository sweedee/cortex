/**
 * Icons that Strato does not have (archive, rocket, checklist, flask), and the icon per skill.
 * Everything else must come from `@dynatrace/strato-icons`; sizing convention for all icons is the
 * Strato `size` prop (a number in px, or 'small' = 16 / 'large' = 32; default 20), which these follow too.
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
  IdeaIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MarkdownIcon,
  RepairIcon,
  UpgradeIcon,
  ViewIcon,
  PlusIcon,
} from '@dynatrace/strato-icons';

interface P {
  size?: number | 'small' | 'large';
}
const px = (s: P['size']) => (typeof s === 'number' ? s : s === 'small' ? 16 : s === 'large' ? 32 : 20);
/** Shared wrapper for hand-drawn icons (16-unit outline, scaled to the Strato size convention). */
export function StrokeIcon({ size, children }: P & { children: ReactElement | ReactElement[] }) {
  return (
    <svg width={px(size)} height={px(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const svg = (size: P['size'], children: ReactElement | ReactElement[]) => <StrokeIcon size={size}>{children}</StrokeIcon>;

/** Pull request: Strato's compare icon (two branch nodes with arrows). */
export function PullRequestIcon({ size }: P) {
  return <CompareIcon size={size} />;
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
  'create-ticket': () => <PlusIcon />,
  'review-renovate': () => <UpgradeIcon />,
  brainstorm: () => <IdeaIcon />,
  plan: () => <ListIcon />,
  grill: () => <CrosshairIcon />,
  implement: () => <CodeIcon />,
  rebase: () => <CycleIcon />,
  review: () => <ViewIcon />,
  'review-pr': () => <MagnifyingGlassIcon />,
  'address-review': () => <ChatIcon />,
  'describe-pr': () => <MarkdownIcon />,
  'fix-ci': () => <RepairIcon />,
  'explain-build': () => <AiIcon />,
  'fix-tests': () => <RepairIcon />,
  'status-summary': () => <AiIcon />,
  'continue-session': () => <ChatIcon />,
  'fork-session': () => <DuplicateIcon />,
};
export const skillIcon = (name: string) => (SKILL_ICONS[name] ?? (() => <AiIcon />))();
