import { CycleIcon, DescriptionIcon, ExternalLinkIcon, RepairIcon } from '@dynatrace/strato-icons';
import { showToast } from '@dynatrace/strato-components/notifications';
import { userConfig } from '../../data/config';
import { ghOps } from '../../data/gh';
import type { ItemOf } from '../../domain';
import { inspect, patchData } from '../../store';
import { openForm } from '../../ui/form';
import { openUrl } from '../../ui/task';
import { paren, quoted, skill, toast } from '../common';
import type { KindModule } from '../types';
import { buildFailed, buildRing, ciProvider, duration, externalLabel, rerunBlocked, rerunMode } from './logic';
import { BuildSidebar } from './Sidebar';
import { buildSync } from './sync';

export { buildFailed, buildRing } from './logic';

type Build = ItemOf<'build'>;

/** Rerun: through gh for Actions runs (optionally only the failed jobs), else on the CI's own page. */
export async function rerunBuild(b: Build) {
  if (rerunMode(b.data) === 'external') {
    showToast({
      type: 'info',
      title: `Re-run ${b.data.name} on its own page`,
      message: `${ciProvider(b.data).name === 'CI' ? 'This CI' : ciProvider(b.data).name} reports through the GitHub checks API, which gh can't re-trigger. Opened the details page instead.`,
      lifespan: 8000,
    });
    return openUrl(b.data.url);
  }
  const failed = buildFailed(b) || b.data.conclusion === 'cancelled';
  await openForm({
    title: `Re-run ${b.title}?`,
    description: `gh run rerun ${b.data.runId} on ${b.data.repo}`,
    submitLabel: 'Re-run',
    fields: [{ name: 'failedOnly', label: 'Only the failed jobs', type: 'checkbox', default: failed, hint: failed ? undefined : 'Nothing failed: this re-runs every job.' }],
    onSubmit: async (v) => {
      await ghOps.runRerun(b.data.repo, Number(b.data.runId), { failedOnly: v.failedOnly === true });
      patchData<'build'>(b, { state: 'queued', conclusion: undefined }, { notice: undefined });
      toast('Re-run requested', b.title, 'info');
    },
  });
}

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

  describe: ({ data: d }) => `CI build ${quoted(d.name)} on ${d.branch}${paren([d.conclusion ?? d.state, d.stage && `stage ${d.stage}`, d.url])}`,
  sync: buildSync,
  multiActions: (_, only) => (only ? [skill('fix-multi', 'Fix all builds', 'fix-ci')] : []),

  actions: ([b]) => {
    const failed = buildFailed(b);
    const mode = rerunMode(b.data);
    return [
      ...(failed ? [skill('fix-ci', 'Fix CI', 'fix-ci', { primary: true })] : []),
      { id: 'details', label: 'View details', type: 'view', icon: <DescriptionIcon />, primary: !failed, run: ([x]) => inspect(x.id) },
      skill('explain', 'Explain failure', 'explain-build', { disabled: failed ? undefined : 'Build did not fail' }),
      {
        id: 'rerun',
        label: mode === 'external' ? 'Re-run (on CI page)' : 'Re-run…',
        type: mode === 'external' ? 'external' : 'direct',
        icon: <CycleIcon />,
        disabled: rerunBlocked(b.data),
        run: () => void rerunBuild(b),
      },
      {
        id: 'open',
        label: externalLabel(b.data),
        type: 'external',
        icon: <ExternalLinkIcon />,
        disabled: b.data.url ? undefined : 'No details URL',
        run: () => void openUrl(b.data.url),
      },
    ];
  },

  Sidebar: BuildSidebar,

  addable: {
    label: 'Watch CI build…',
    hint: 'job/branch, e.g. console-ui/main',
    example: 'console-ui/main',
    create: (v, proj) => {
      const [name, branch] = v.includes('/') ? [v.split('/')[0], v.split('/').slice(1).join('/')] : [proj?.title ?? v, v];
      const n = Math.floor(Math.random() * 900 + 1900);
      return {
        kind: 'build',
        handle: `build-${n}`,
        title: `${name} #${n}`,
        data: { repo: proj?.data.repo ?? `unknown/${name}`, name, url: '', number: n, state: 'queued', branch: branch || userConfig().git.defaultBranch },
      };
    },
  },
};
