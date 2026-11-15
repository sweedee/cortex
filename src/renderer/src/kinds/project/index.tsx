import { PlusIcon, SettingIcon, WorkflowIcon } from '@dynatrace/strato-icons';
import { codeHost } from '../../data/codehost';
import { KINDS, type ItemOf, type Segment } from '../../domain';
import { external, openInEditorAction, openPathAction, paren, skill } from '../common';
import type { KindModule } from '../types';
import { ProjectSidebar } from './Sidebar';
import { projectSync } from './sync';
import { openProjectSettings } from './settings';
import { openNewWorktree } from './worktreeFlow';
import { hasBaseDir, SET_BASE_HINT } from './worktreeModel';

export { openProjectSettings } from './settings';

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
      const head = out[0];
      if (head) out[0] = { ...head, weight: 3 };
      out.push({ tone: 'warning', label: `${renovate} Renovate PR${renovate === 1 ? '' : 's'} waiting`, weight: 1 });
    }
    return out;
  },

  facts: (p, ctx) => {
    const worktrees = ctx.inProject(p.id, 'worktree').filter((w) => !w.archived).length;
    const openPrs = p.data.stats?.openPrs ?? ctx.inProject(p.id, 'pr').filter((pr) => pr.data.state === 'open').length;
    // kinds with a project section (deployments) are counted too
    const sections = KINDS.flatMap((k) => {
      const sec = ctx.kind(k).projectSection;
      const n = sec ? ctx.inProject(p.id, k).length : 0;
      return sec && n ? [[sec.label, String(n)] as [string, string]] : [];
    });
    return [
      ['Open PRs', String(openPrs)],
      ['Worktrees', String(worktrees)],
      ['Default branch', p.data.defaultBranch],
      ['Base dir', p.data.baseDir ?? 'not set'],
      ...(p.data.startCommand ? [['Start', p.data.startCommand] as [string, string]] : []),
      ...(p.data.testCommand ? [['Tests', p.data.testCommand] as [string, string]] : []),
      ...sections,
    ];
  },

  subtitle: (p) => p.data.repo,

  describe: ({ data: d }) => `project ${d.repo}${d.baseDir ? ` checked out at ${d.baseDir}` : ''}${paren([`default branch ${d.defaultBranch}`])}`,
  paths: ({ data }) => [data.baseDir, data.worktreesDir],
  sync: projectSync,

  actions: ([p]) => {
    const renovate = p.data.stats?.renovatePrs ?? 0;
    const base = p.data.baseDir;
    const noBase = hasBaseDir(p.data) ? undefined : SET_BASE_HINT;
    return [
      skill('create-ticket', 'Create ticket', 'create-ticket', { primary: true }),
      skill('renovate', renovate > 0 ? `Review Renovate PRs (${renovate})` : 'Review Renovate PRs', 'review-renovate'),
      {
        id: 'new-wt',
        label: 'New worktree…',
        type: 'direct',
        icon: <PlusIcon />,
        run: ([x]) => void openNewWorktree(x as ItemOf<'project'>),
      },
      external('repo', 'Open repo', (i) => (i.kind === 'project' ? codeHost(i.data.provider).repoUrl(i.data.repo) : ''), {
        disabled: p.data.repo.startsWith('unknown/') ? 'No GitHub repo set' : undefined,
      }),
      openPathAction('folder', 'Open folder', (i) => (i.kind === 'project' ? i.data.baseDir : undefined), { disabled: noBase }),
      openInEditorAction('editor', 'Open in editor', (i) => (i.kind === 'project' ? i.data.baseDir : undefined), { disabled: base ? noBase : SET_BASE_HINT }),
      {
        id: 'settings',
        label: 'Settings…',
        type: 'direct',
        icon: <SettingIcon />,
        run: ([x]) => void openProjectSettings(x?.kind === 'project' ? x : undefined),
      },
    ];
  },

  Sidebar: ProjectSidebar,

  addable: {
    label: 'Add project…',
    hint: 'owner/repo',
    example: 'octo/repo',
    // a project never belongs to a project
    linkLabel: false,
    open: (at) => void openProjectSettings(undefined, at),
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
