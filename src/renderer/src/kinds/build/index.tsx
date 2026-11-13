import { CycleIcon, DescriptionIcon, RepairIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { openDialog, patchData } from '../../store';
import { external, skill, toast } from '../common';
import type { KindModule } from '../types';

type Build = ItemOf<'build'>;

export const buildFailed = (b: Build) => b.data.state === 'completed' && (b.data.conclusion === 'failure' || b.data.conclusion === 'timed_out');

export function buildRing(b: Build): Segment[] {
  const d = b.data;
  if (d.state === 'queued') return [{ tone: 'running', label: 'Queued' }];
  if (d.state === 'in_progress') return [{ tone: 'running', label: d.stage ? `Running · ${d.stage}` : 'Running' }];
  if (buildFailed(b)) return [{ tone: 'critical', label: d.stage ? `Failed · ${d.stage}` : 'Failed' }];
  if (d.conclusion === 'cancelled' || d.conclusion === 'skipped') return [{ tone: 'neutral', label: d.conclusion === 'cancelled' ? 'Cancelled' : 'Skipped' }];
  return [{ tone: 'success', label: 'Passed' }];
}

const duration = (s?: number) => (s == null ? '–' : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

export const build: KindModule<'build'> = {
  kind: 'build',
  label: 'CI build',
  icon: (s) => <RepairIcon size={s} />,
  radius: 26,
  level: 4,

  ring: buildRing,
  short: (b) => (b.data.number != null ? String(b.data.number) : '…'),
  subtitle: (b) => {
    const d = b.data;
    const what = d.state !== 'completed' ? (d.stage ? `running ${d.stage}` : 'running') : buildFailed(b) ? `failed${d.stage ? ` in ${d.stage}` : ''}` : (d.conclusion ?? 'done');
    return `${d.branch} · ${what}`;
  },
  facts: ({ data }) => [
    ['Duration', duration(data.durationSec)],
    ['Trigger', data.trigger ?? '–'],
    ['Stage', data.stage ?? (data.state === 'completed' ? 'done' : '–')],
    ['Workflow', data.name],
  ],

  actions: ([b]) => {
    const failed = buildFailed(b);
    return [
      ...(failed ? [skill('fix-ci', 'Fix CI', 'fix-ci', { primary: true })] : []),
      { id: 'log', label: 'View log', type: 'view', icon: <DescriptionIcon />, primary: !failed, run: ([x]) => openDialog({ type: 'log', itemId: x.id }) },
      skill('explain', 'Explain failure', 'explain-build', { disabled: failed ? undefined : 'Build did not fail' }),
      {
        id: 'rerun',
        label: 'Re-run',
        type: 'direct',
        icon: <CycleIcon />,
        run: () => {
          patchData<'build'>(b, { state: 'queued', conclusion: undefined }, { notice: undefined });
          toast('Build re-triggered', b.title, 'info');
        },
      },
      external('jenkins', 'Open in Jenkins', (i) => (i.kind === 'build' ? i.data.url : '')),
    ];
  },

  addable: {
    label: 'Watch CI build…',
    hint: 'job/branch, e.g. console-ui/main',
    create: (v, proj) => {
      const [name, branch] = v.includes('/') ? [v.split('/')[0], v.split('/').slice(1).join('/')] : [proj?.title ?? v, v];
      const n = Math.floor(Math.random() * 900 + 1900);
      return {
        kind: 'build',
        handle: `build-${n}`,
        title: `${name} #${n}`,
        data: { repo: proj?.data.repo ?? `unknown/${name}`, name, url: '', number: n, state: 'queued', branch: branch || 'main' },
      };
    },
  },
};
