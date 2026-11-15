import { CodeIcon, DeleteIcon, DesktopIcon, UploadIcon } from '@dynatrace/strato-icons';
import { userConfig } from '../../data/config';
import type { ItemOf, Segment } from '../../domain';
import { openInEditorAction, openPathAction, skill } from '../common';
import { FlaskIcon } from '../icons';
import type { KindModule } from '../types';
import { createPr, launchApp, removeWorktree, runTests } from './actions';
import { launchDisabled, pathDisabled, prDisabled, removeDisabled, testsDisabled } from './model';
import { WorktreeSidebar } from './Sidebar';

export function worktreeRing({ data }: ItemOf<'worktree'>): Segment[] {
  const g = data.git;
  if (!g) return [{ tone: 'neutral', label: 'git status not checked yet' }];
  const out: Segment[] = [];
  if (g.behind > 0) out.push({ tone: 'warning', label: `${g.behind} commit${g.behind === 1 ? '' : 's'} behind ${data.baseBranch}`, weight: 2 });
  else out.push({ tone: 'success', label: g.changedFiles ? `up to date with ${data.baseBranch}` : 'clean, up to date', weight: 2 });
  if (g.changedFiles > 0) out.push({ tone: 'warning', label: `${g.changedFiles} uncommitted file${g.changedFiles === 1 ? '' : 's'}`, weight: 1 });
  return out.length === 1 ? [{ ...out[0], weight: undefined }] : out;
}

const lastSegment = (branch: string) => branch.split('/').pop() ?? branch;

export const worktree: KindModule<'worktree'> = {
  kind: 'worktree',
  label: 'Worktree',
  icon: (s) => <CodeIcon size={s} />,
  radius: 32,
  level: 2,

  ring: worktreeRing,
  subtitle: (w) => w.data.path,
  facts: ({ data }) => [
    ['Branch', data.branch],
    ['Ahead / behind', data.git ? `${data.git.ahead} / ${data.git.behind}` : '–'],
    ['Changed files', data.git ? String(data.git.changedFiles) : '–'],
    ['Base', data.baseBranch],
  ],

  actions: ([w], ctx) => {
    const project = ctx.projectOf(w);
    return [
      {
        id: 'create-pr',
        label: 'Create PR…',
        type: 'direct',
        icon: <UploadIcon />,
        primary: true,
        disabled: prDisabled(w, project),
        run: ([x]) => void createPr(x as ItemOf<'worktree'>, ctx),
      },
      skill('rebase', 'Rebase', 'rebase'),
      {
        id: 'launch',
        label: 'Launch app',
        type: 'direct',
        icon: <DesktopIcon />,
        disabled: launchDisabled(w, project),
        run: ([x]) => void launchApp(x as ItemOf<'worktree'>, ctx),
      },
      {
        id: 'tests',
        label: 'Run tests',
        type: 'direct',
        icon: <FlaskIcon />,
        disabled: testsDisabled(w, project),
        run: ([x]) => void runTests(x as ItemOf<'worktree'>, ctx),
      },
      skill('review', 'Review', 'review'),
      openInEditorAction('ide', 'Open in editor', (i) => (i.kind === 'worktree' ? i.data.path : undefined), { disabled: pathDisabled(w) }),
      openPathAction('folder', 'Open folder', (i) => (i.kind === 'worktree' ? i.data.path : undefined), { disabled: pathDisabled(w) }),
      {
        id: 'remove-wt',
        label: 'Remove worktree…',
        type: 'direct',
        icon: <DeleteIcon />,
        danger: true,
        disabled: removeDisabled(w, project),
        run: ([x]) => void removeWorktree(x as ItemOf<'worktree'>, ctx),
      },
    ];
  },

  complete: () => ({}),

  Sidebar: WorktreeSidebar,

  addable: {
    label: 'Create worktree…',
    hint: 'branch name, e.g. feat/CTX-1234-thing',
    detect: (v) => /^(feat|fix|chore|spike)\//.test(v),
    create: (v, proj) => {
      const leaf = lastSegment(v);
      const dir = proj?.data.worktreesDir ?? `~/wt/${proj?.title ?? 'repo'}`;
      return {
        kind: 'worktree',
        handle: `wt/${leaf}`,
        title: v,
        data: {
          path: `${dir}/${leaf}`,
          branch: v,
          baseBranch: proj?.data.defaultBranch ?? userConfig().git.defaultBranch,
          ticketKey: v.match(/[A-Z][A-Z0-9]+-\d+/)?.[0],
          git: { ahead: 0, behind: 0, dirty: false, changedFiles: 0 },
        },
      };
    },
  },
};
