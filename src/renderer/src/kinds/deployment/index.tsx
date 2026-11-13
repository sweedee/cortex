import { EditIcon } from '@dynatrace/strato-icons';
import type { DeploymentData, ItemOf, Segment, Tone } from '../../domain';
import { external, placeholder } from '../common';
import { RocketIcon } from '../icons';
import type { KindModule } from '../types';

export const stageLabel = (d: DeploymentData) => (d.stage === 'custom' ? (d.stageLabel ?? 'custom') : d.stage);
const STAGE_TONE: Record<DeploymentData['stage'], Tone> = { dev: 'primary', staging: 'pending', prod: 'warning', custom: 'neutral' };

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

const guessStage = (url: string): DeploymentData['stage'] => (/\bdev\b|dev\.|localhost/i.test(url) ? 'dev' : /stag/i.test(url) ? 'staging' : 'prod');

/** Where a project runs (dev / staging / prod …). Health is mocked until there is an integration. */
export const deployment: KindModule<'deployment'> = {
  kind: 'deployment',
  label: 'Deployment',
  icon: (s) => <RocketIcon size={s} />,
  radius: 28,
  level: 1,

  ring: deploymentRing,
  badge: ({ data }) => ({ label: stageLabel(data), tone: STAGE_TONE[data.stage] }),
  subtitle: (d) => d.data.url,
  facts: ({ data }) => [
    ['Stage', stageLabel(data)],
    ['URL', data.url],
    ['Version', data.version ?? '–'],
    ['Health', `${data.health ?? 'unknown'} (mocked)`],
  ],

  actions: () => [
    external('open', 'Open', (i) => (i.kind === 'deployment' ? i.data.url : ''), { primary: true }),
    placeholder('edit', 'Edit…', <EditIcon />),
  ],

  addable: {
    label: 'Add deployment…',
    hint: 'URL, e.g. https://dev.example.com',
    detect: (v) => /^https?:\/\//.test(v) && !/github\.com|\/browse\//.test(v),
    create: (v, proj) => {
      const stage = guessStage(v);
      const name = proj?.title ?? (v.replace(/^https?:\/\//, '').split(/[/.]/)[0] || 'app');
      return { kind: 'deployment', handle: `${name}-${stage}`, title: `${name} ${stage}`, data: { url: v, stage, health: 'unknown' } };
    },
  },
};
