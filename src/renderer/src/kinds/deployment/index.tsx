import { EditIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { defineKind, external, paren } from '../common';
import { RocketIcon } from '../icons';
import { openDeploymentForm } from './form';
import { guessStage, mockStatus, stageLabel, STAGE_TONE } from './model';
import { DeploymentSidebar } from './Sidebar';

export { stageLabel } from './model';

export function deploymentRing({ data }: ItemOf<'deployment'>): Segment[] {
  switch (data.health) {
    case 'up':
      return [{ tone: 'success', label: 'Up' }];
    case 'degraded':
      return [{ tone: 'warning', label: 'Degraded' }];
    case 'down':
      return [{ tone: 'critical', label: 'Down' }];
    default:
      return [{ tone: 'neutral', label: 'Status unknown' }];
  }
}

/** Where a project runs (dev / staging / prod …). Health is mocked until there is an integration (see `model.ts` `mockStatus`). */
export const deployment = defineKind({
  kind: 'deployment',
  label: 'Deployment',
  icon: (s) => <RocketIcon size={s} />,
  level: 1,

  ring: deploymentRing,
  badge: ({ data }) => ({ label: stageLabel(data), tone: STAGE_TONE[data.stage] }),
  subtitle: (d) => d.data.url,
  facts: ({ id, data }) => [
    ['Stage', stageLabel(data)],
    ['URL', data.url],
    ['Version', mockStatus(id, Date.now(), data).version],
    ['Health', `${data.health ?? 'unknown'} (mocked)`],
  ],

  describe: ({ data: d }) => `${d.stageLabel ?? d.stage} deployment at ${d.url}${paren([d.version])}`,
  projectSection: {
    label: 'Deployments',
    addLabel: 'Add deployment',
    empty: 'No deployments yet.',
    url: (d) => d.data.url,
    hint: (d) => d.data.url,
  },

  actions: () => [
    external('open', 'Open', (i) => (i.kind === 'deployment' ? i.data.url : ''), { primary: true }),
    {
      id: 'edit',
      label: 'Edit…',
      type: 'direct',
      icon: <EditIcon />,
      run: ([d]) => void openDeploymentForm({ deployment: d as ItemOf<'deployment'> }),
    },
  ],

  Sidebar: DeploymentSidebar,

  addable: {
    label: 'Add deployment…',
    hint: 'URL, e.g. https://dev.example.com',
    example: 'https://dev.example.com',
    detect: (v) => /^https?:\/\//.test(v) && !/github\.com|\/browse\//.test(v),
    openIn: (project) => void openDeploymentForm({ project }),
    create: (v, proj) => {
      const stage = guessStage(v);
      const name = proj?.title ?? (v.replace(/^https?:\/\//, '').split(/[/.]/)[0] || 'app');
      return { kind: 'deployment', handle: `${name}-${stage}`, title: `${name} ${stage}`, data: { url: v, stage, health: 'unknown' } };
    },
  },
});
