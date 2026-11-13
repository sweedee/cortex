import { LabelIcon, PlusIcon, SorterIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { place } from '../../layout';
import { openDialog } from '../../store';
import { external, placeholder, skill } from '../common';
import type { KindModule } from '../types';

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
  icon: (s) => <LabelIcon size={s} />,
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

  actions: ([t]) => {
    const todo = t.data.statusCategory === 'new' || ticketRing(t)[0].tone === 'critical';
    return [
      skill('plan', 'Plan', 'plan-ticket', { primary: todo }),
      skill('brainstorm', 'Brainstorm', 'brainstorm'),
      skill('implement', 'Implement', 'implement', { primary: t.data.statusCategory === 'indeterminate' }),
      skill('refine', 'Refine ticket', 'refine-ticket'),
      placeholder('status', 'Change status…', <SorterIcon />),
      {
        id: 'start',
        label: 'Create worktree',
        type: 'direct',
        icon: <PlusIcon />,
        run: ([x]) => openDialog({ type: 'add', kind: 'worktree', at: place.near(x.id) }),
      },
      external('jira', 'Open in Jira', (i) => `jira.ctx.internal/browse/${i.handle}`),
    ];
  },

  complete: () => ({ status: 'Done', statusCategory: 'done' }),

  addable: {
    label: 'Import Jira ticket…',
    hint: 'CTX-1234 or a Jira URL',
    detect: (v) => /^[A-Z][A-Z0-9]+-\d+$/.test(v) || /\/browse\//.test(v),
    create: (v) => {
      const key = v.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? v;
      return { kind: 'ticket', handle: key, title: `Imported ticket ${key}`, data: { key, status: 'To Do', statusCategory: 'new', type: 'Story', priority: 'Medium' } };
    },
  },
};
