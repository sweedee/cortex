import { CheckmarkIcon, DocumentIcon, ViewIcon } from '@dynatrace/strato-icons';
import type { ItemOf, RecordData, Segment } from '../../domain';
import { openDialog, patchData } from '../../store';
import { skill, toast } from '../common';
import type { Action, KindModule } from '../types';

const TYPE_LABEL: Record<RecordData['recordType'], string> = { plan: 'Plan', brainstorm: 'Brainstorm', grill: 'Grill', verification: 'Verification' };

export function recordRing({ data }: ItemOf<'record'>): Segment[] {
  if (data.status === 'done') return [{ tone: 'success', label: 'Done' }];
  if (data.status === 'draft') return [{ tone: 'pending', label: 'Draft, not approved yet' }];
  const s = data.steps;
  if (s && s.total > 0 && s.done > 0 && s.done < s.total) {
    return [
      { tone: 'success', label: `${s.done} step${s.done === 1 ? '' : 's'} done`, weight: s.done },
      { tone: 'neutral', label: `${s.total - s.done} step${s.total - s.done === 1 ? '' : 's'} open`, weight: s.total - s.done },
    ];
  }
  return [{ tone: 'success', label: 'Approved' }];
}

/** `<baseDir>/records/<ticket-branch>/<name>.md` */
export const recordPath = (baseDir: string | undefined, ticketBranch: string | undefined, name: string) =>
  [baseDir ?? '<project>', 'records', ticketBranch, name].filter(Boolean).join('/');

const guessType = (name: string): RecordData['recordType'] =>
  /^brainstorm/i.test(name) ? 'brainstorm' : /^grill/i.test(name) ? 'grill' : /^verif/i.test(name) ? 'verification' : 'plan';

/** The workflow step after this record: plan → grill, brainstorm → plan, grill → implement. */
function nextSteps(r: ItemOf<'record'>): Action[] {
  const approved = r.data.status !== 'draft';
  switch (r.data.recordType) {
    case 'plan':
      return [
        skill('grill', 'Grill the plan', 'grill-plan'),
        skill('implement-plan', 'Implement plan', 'implement-plan', { disabled: approved ? undefined : 'Approve the plan first' }),
      ];
    case 'brainstorm':
      return [skill('write-plan', 'Turn into a plan', 'write-plan')];
    case 'grill':
      return [skill('implement-plan', 'Implement', 'implement-plan')];
    case 'verification':
      return [];
  }
}

export const record: KindModule<'record'> = {
  kind: 'record',
  label: 'Record',
  icon: (s) => <DocumentIcon size={s} />,
  radius: 28,
  level: 2,

  ring: recordRing,
  subtitle: ({ data }) =>
    [TYPE_LABEL[data.recordType], data.status === 'draft' ? 'Draft' : data.status === 'done' ? 'Done' : 'Approved', data.steps && `${data.steps.done} / ${data.steps.total} steps`]
      .filter(Boolean)
      .join(' · '),
  facts: ({ data }) => [
    ['Type', TYPE_LABEL[data.recordType]],
    ...(data.steps ? [['Steps', `${data.steps.done} / ${data.steps.total}`] as [string, string]] : []),
    ['Author', data.author ?? '–'],
    ['Path', data.path],
  ],

  actions: ([r]) => [
    { id: 'view', label: 'View', type: 'view', icon: <ViewIcon />, primary: true, run: ([x]) => openDialog({ type: 'record', itemId: x.id }) },
    ...nextSteps(r),
    ...(r.data.status === 'draft' && r.data.recordType === 'plan'
      ? [
          {
            id: 'approve',
            label: 'Approve',
            type: 'direct' as const,
            icon: <CheckmarkIcon />,
            run: () => {
              patchData<'record'>(r, { status: 'approved' });
              toast('Plan approved', r.title);
            },
          },
        ]
      : []),
  ],

  complete: () => ({ status: 'done' }),

  addable: {
    label: 'New record…',
    hint: 'file name, e.g. PLAN-CTX-1234.md',
    detect: (v) => /^(PLAN|BRAINSTORM|GRILL|VERIFICATION)-.*\.md$/i.test(v),
    create: (v, proj) => {
      const name = /\.md$/i.test(v) ? v : `${v}.md`;
      const ticketKey = name.match(/[A-Z][A-Z0-9]+-\d+/)?.[0];
      return {
        kind: 'record',
        handle: name,
        title: name,
        data: { recordType: guessType(name), path: recordPath(proj?.data.baseDir, ticketKey, name), ticketKey, status: 'draft', author: 'you' },
      };
    },
  },
};
