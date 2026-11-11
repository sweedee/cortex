import type { CSSProperties, ReactNode } from 'react';
import { Chip } from '@dynatrace/strato-components/content';
import Borders from '@dynatrace/strato-design-tokens/borders';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { ChatIcon, CodeIcon, CycleIcon, IdeaIcon, ViewIcon } from '@dynatrace/strato-icons';
import type { AgentKind, AgentSession, SessionStatus } from '../../model/types';
import './session.css';

/** Strato tokens exposed as CSS custom properties for session.css. Spread onto a `.cx-root` element. */
export const cxVars = {
  '--cx-text': Colors.Text.Neutral.Default,
  '--cx-surface': Colors.Background.Surface.Default,
  '--cx-subdued': Colors.Background.Container.Neutral.Subdued,
  '--cx-container': Colors.Background.Container.Neutral.Default,
  '--cx-hover': Colors.Background.Field.Neutral.DefaultHover,
  '--cx-selected': Colors.Background.Field.Primary.Emphasized,
  '--cx-border': Colors.Border.Neutral.Default,
  '--cx-border-subdued': Colors.Border.Neutral.Subdued,
  '--cx-border-strong': Colors.Border.Neutral.DefaultActive,
  '--cx-primary': Colors.Border.Primary.Accent,
  '--cx-focus': Colors.Border.Primary.Accent,
  '--cx-radius-sm': Borders.Radius.Field.Subdued,
  '--cx-radius': Borders.Radius.Container.Subdued,
  '--cx-radius-lg': Borders.Radius.Container.Default,
} as CSSProperties;

export const subduedText: CSSProperties = { color: Colors.Text.Neutral.Subdued };

// ---- agent kinds -------------------------------------------------------------

export interface KindMeta {
  kind: AgentKind;
  label: string;
  /** one line describing what launching this agent does */
  description: string;
  icon: ReactNode;
}

export const AGENT_KINDS: KindMeta[] = [
  {
    kind: 'plan',
    label: 'Plan',
    description: 'Reads the ticket and the code, then writes an implementation plan.',
    icon: <IdeaIcon />,
  },
  {
    kind: 'implement',
    label: 'Implement',
    description: 'Makes the change in the worktree, with tests and small commits.',
    icon: <CodeIcon />,
  },
  {
    kind: 'review',
    label: 'Self-review',
    description: 'Reviews the branch diff critically before anyone else sees it.',
    icon: <ViewIcon />,
  },
  {
    kind: 'fix-ci',
    label: 'Fix CI',
    description: 'Reads the failing build, reproduces it locally and pushes a fix.',
    icon: <CycleIcon />,
  },
  {
    kind: 'chat',
    label: 'New chat',
    description: 'Ask questions about this work without changing anything.',
    icon: <ChatIcon />,
  },
];

const KIND_BY_ID = Object.fromEntries(AGENT_KINDS.map((k) => [k.kind, k])) as Record<AgentKind, KindMeta>;
export const kindMeta = (kind: AgentKind): KindMeta => KIND_BY_ID[kind];
export const kindLabel = (kind: AgentKind) => (kind === 'chat' ? 'Chat' : KIND_BY_ID[kind].label);

// ---- status ------------------------------------------------------------------

type Tone = 'primary' | 'warning' | 'success' | 'critical';

const STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'primary' },
  waiting: { label: 'Waiting for you', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
};

const TONE_COLOR: Record<Tone, string> = {
  primary: Colors.Icon.Primary.Default,
  warning: Colors.Icon.Warning.Default,
  success: Colors.Icon.Success.Default,
  critical: Colors.Icon.Critical.Default,
};

/** A chat that simply idles between turns is not "waiting for you" in any urgent sense. */
export const isIdleChat = (s: AgentSession) => s.kind === 'chat' && s.status === 'waiting' && !s.activity;

export const statusLabel = (s: AgentSession) => (isIdleChat(s) ? 'Idle' : STATUS[s.status].label);

export function StatusDot({ session }: { session: AgentSession }) {
  const idle = isIdleChat(session);
  return (
    <span
      className="cx-dot"
      data-pulse={session.status === 'running'}
      style={{ background: idle ? Colors.Icon.Neutral.Disabled : TONE_COLOR[STATUS[session.status].tone] }}
      aria-hidden
    />
  );
}

export function StatusChip({ session }: { session: AgentSession }) {
  if (isIdleChat(session)) {
    return (
      <Chip color="neutral" size="condensed">
        Idle
      </Chip>
    );
  }
  const { label, tone } = STATUS[session.status];
  return (
    <Chip color={tone} variant="emphasized" size="condensed">
      {label}
    </Chip>
  );
}

// ---- time --------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "10:01" for today, "Yesterday 14:02", otherwise "Nov 9, 14:02". */
export function formatStarted(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days === 0) return clock(iso);
  if (days === 1) return `Yesterday ${clock(iso)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clock(iso)}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
