import { CheckmarkIcon, DocumentIcon, ViewIcon } from '@dynatrace/strato-icons';
import type { ItemOf, RecordData, Segment } from '../../domain';
import { userConfig } from '../../data/config';
import { inspect, patchData, select } from '../../store';
import { openInEditorAction, openPathAction, skill, toast } from '../common';
import type { Action, KindModule } from '../types';
import { dirOf, isAbsolutePath, recordTypeOf } from './model';
import { RecordSidebar } from './Sidebar';

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

/** `<baseDir>/<records.dir>/<ticket-branch>/<name>.md` (config.json `records.dir`, default `records`) */
export const recordPath = (baseDir: string | undefined, ticketBranch: string | undefined, name: string, dir = userConfig().records.dir) =>
  [baseDir ?? '<project>', dir, ticketBranch, name].filter(Boolean).join('/');

const guessType = (name: string): RecordData['recordType'] => recordTypeOf(/\.md$/i.test(name) ? name : `${name}.md`) ?? 'plan';

/** The workflow step after this record: plan → grill, brainstorm → plan, grill → implement. */
export function nextSteps(r: ItemOf<'record'>): Action[] {
  switch (r.data.recordType) {
    case 'plan':
      return [skill('grill', 'Grill', 'grill')];
    case 'brainstorm':
      return [skill('plan', 'Plan', 'plan')];
    case 'grill':
      return [skill('implement', 'Implement', 'implement')];
    case 'verification':
      return [];
  }
}

const fileOf = (i: { kind: string; data?: unknown }) => (i.kind === 'record' ? (i.data as RecordData).path : undefined);

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

  actions: ([r]) => {
    const missing = isAbsolutePath(r.data.path) ? undefined : 'No file on disk (demo data)';
    return [
      {
        id: 'view',
        label: 'View',
        type: 'view',
        icon: <ViewIcon />,
        primary: true,
        run: ([x]) => {
          inspect(x.id);
          select([x.id]);
        },
      },
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
      openInEditorAction('editor', 'Open in editor', fileOf, { disabled: missing }),
      openPathAction('folder', 'Open folder', (i) => (isAbsolutePath(fileOf(i)) ? dirOf(fileOf(i)!) : undefined), { disabled: missing }),
    ];
  },

  complete: () => ({ status: 'done' }),

  Sidebar: RecordSidebar,

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
