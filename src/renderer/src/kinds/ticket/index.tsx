import { PlusIcon, StepIcon, SuccessIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { external, paren, quoted, skill } from '../common';
import { openNewWorktree } from '../project/worktreeFlow';
import type { KindModule } from '../types';
import { completeTickets, openChangeStatus, ticketUrl } from './actions';
import { TicketIcon } from './icon';
import { TicketSidebar } from './Sidebar';
import { ticketSync } from './sync';

const BLOCKER = /blocker|highest/i;

/** One segment from the Jira status (+ priority). */
export function ticketRing({ data }: ItemOf<'ticket'>): Segment[] {
  if (data.statusCategory === 'done') return [{ tone: 'success', label: data.status }];
  if (data.priority && BLOCKER.test(data.priority)) return [{ tone: 'critical', label: `${data.priority} · ${data.status}` }];
  if (/review/i.test(data.status)) return [{ tone: 'pending', label: data.status }];
  if (data.statusCategory === 'indeterminate') return [{ tone: 'primary', label: data.status }];
  return [{ tone: 'neutral', label: data.status }];
}

export const ticket: KindModule<'ticket'> = {
  kind: 'ticket',
  label: 'Ticket',
  icon: (s) => <TicketIcon size={s} />,
  radius: 38,
  level: 1,

  ring: ticketRing,
  short: (t) => t.data.key.split('-')[1] ?? t.data.key,
  subtitle: ({ data }) => [data.type, data.priority, data.status].filter(Boolean).join(' · '),
  facts: ({ data }) => [
    ['Assignee', data.assignee ?? 'unassigned'],
    ['Sprint', data.sprint ?? '–'],
    ['Points', data.points != null ? String(data.points) : '–'],
    ...(data.branch ? [['Branch', data.branch] as [string, string]] : []),
  ],

  describe: (t) => {
    const d = t.data;
    return `Jira ticket ${d.key} ${quoted(t.title)}${paren([d.status, d.type, d.branch && `branch ${d.branch}`])}`;
  },
  sync: ticketSync,
  multiActions: () => [skill('plan-multi', 'Plan together', 'plan')],

  actions: ([t], ctx) => {
    const todo = t.data.statusCategory === 'new' || ticketRing(t)[0].tone === 'critical';
    const project = ctx.projectOf(t);
    return [
      skill('plan', 'Plan', 'plan', { primary: todo }),
      skill('brainstorm', 'Brainstorm', 'brainstorm'),
      {
        id: 'status',
        label: 'Change status…',
        type: 'direct',
        icon: <StepIcon />,
        run: ([x]) => void openChangeStatus(x as ItemOf<'ticket'>),
      },
      {
        id: 'start',
        label: 'Create worktree…',
        type: 'direct',
        icon: <PlusIcon />,
        disabled: project ? undefined : 'This ticket is not in a project',
        run: ([x]) => {
          const p = ctx.projectOf(x);
          if (p) void openNewWorktree(p, { ticket: x as ItemOf<'ticket'> });
        },
      },
      external('jira', 'Open in Jira', (i) => (i.kind === 'ticket' ? ticketUrl(i.data.key) : '')),
      // not the shared "complete" (a local patch): Jira is transitioned first, see actions.ts
      {
        id: 'complete',
        label: 'Mark done',
        type: 'direct',
        icon: <SuccessIcon />,
        run: (items) => void completeTickets(items as ItemOf<'ticket'>[]),
      },
    ];
  },

  Sidebar: TicketSidebar,

  addable: {
    label: 'Import Jira ticket…',
    hint: 'CTX-1234 or a Jira URL',
    example: 'CTX-1',
    linkLabel: 'in project',
    detect: (v) => /^[A-Z][A-Z0-9]+-\d+$/.test(v) || /\/browse\//.test(v),
    create: (v) => {
      const key = v.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? v;
      return { kind: 'ticket', handle: key, title: `Imported ticket ${key}`, data: { key, status: 'To Do', statusCategory: 'new', type: 'Story', priority: 'Medium' } };
    },
  },
};
