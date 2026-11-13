import { PlusIcon, WorkflowIcon } from '@dynatrace/strato-icons';
import type { Segment } from '../../domain';
import { place } from '../../layout';
import { openDialog } from '../../store';
import { external, skill } from '../common';
import type { KindModule } from '../types';

export const project: KindModule<'project'> = {
  kind: 'project',
  label: 'Project',
  icon: (s) => <WorkflowIcon size={s} />,
  radius: 54,
  level: 0,
  titleInside: true,

  ring: ({ data }) => {
    const main = data.stats?.mainChecks;
    const renovate = data.stats?.renovatePrs ?? 0;
    const out: Segment[] = [
      main === 'success'
        ? { tone: 'success', label: `${data.defaultBranch} is green` }
        : main === 'failure'
          ? { tone: 'critical', label: `${data.defaultBranch} is failing` }
          : main === 'pending'
            ? { tone: 'running', label: `${data.defaultBranch}: checks running` }
            : { tone: 'neutral', label: 'no CI status yet' },
    ];
    if (renovate > 0) {
      out[0] = { ...out[0], weight: 3 };
      out.push({ tone: 'warning', label: `${renovate} Renovate PR${renovate === 1 ? '' : 's'} waiting`, weight: 1 });
    }
    return out;
  },

  facts: (p, ctx) => {
    const worktrees = ctx.inProject(p.id, 'worktree').filter((w) => !w.archived).length;
    const openPrs = p.data.stats?.openPrs ?? ctx.inProject(p.id, 'pr').filter((pr) => pr.data.state === 'open').length;
    const deployments = ctx.inProject(p.id, 'deployment').length;
    return [
      ['Open PRs', String(openPrs)],
      ['Worktrees', String(worktrees)],
      ['Default branch', p.data.defaultBranch],
      ['Base dir', p.data.baseDir ?? 'not set'],
      ...(p.data.startCommand ? [['Start', p.data.startCommand] as [string, string]] : []),
      ...(p.data.testCommand ? [['Tests', p.data.testCommand] as [string, string]] : []),
      ...(deployments ? [['Deployments', String(deployments)] as [string, string]] : []),
    ];
  },

  subtitle: (p) => p.data.repo,

  actions: () => [
    skill('plan-feature', 'Plan a feature', 'plan-feature', { primary: true }),
    skill('create-ticket', 'Create ticket', 'create-ticket'),
    skill('triage', 'Triage tickets', 'triage-tickets'),
    skill('renovate', 'Review Renovate PRs', 'review-renovate'),
    {
      id: 'new-wt',
      label: 'New worktree',
      type: 'direct',
      icon: <PlusIcon />,
      run: ([p]) => openDialog({ type: 'add', kind: 'worktree', at: place.near(p.id) }),
    },
    external('repo', 'Open repo', (i) => `github.com/${i.kind === 'project' ? i.data.repo : ''}`),
  ],

  addable: {
    label: 'Add project…',
    hint: 'owner/repo',
    create: (v) => {
      const name = v.split('/').pop()!.trim() || v;
      return {
        kind: 'project',
        handle: name,
        title: name,
        data: { repo: /^[\w.-]+\/[\w.-]+$/.test(v) ? v : `unknown/${name.replace(/[^\w.-]/g, '-')}`, defaultBranch: 'main' },
      };
    },
  },
};
