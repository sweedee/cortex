import { CodeIcon, DeleteIcon, DesktopIcon, TerminalIcon, UploadIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { openDialog, removeItems } from '../../store';
import { placeholder, skill, toast } from '../common';
import { FlaskIcon } from '../icons';
import type { KindModule } from '../types';

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

  actions: () => [
    skill('implement', 'Implement', 'implement', { primary: true }),
    skill('self-review', 'Review', 'self-review'),
    skill('rebase', 'Rebase', 'rebase'),
    placeholder('create-pr', 'Create PR…', <UploadIcon />),
    placeholder('launch', 'Launch app', <DesktopIcon />),
    placeholder('tests', 'Run tests', <FlaskIcon />),
    placeholder('ide', 'Open in IDE', <TerminalIcon />, { type: 'external' }),
    {
      id: 'remove-wt',
      label: 'Remove worktree',
      type: 'direct',
      icon: <DeleteIcon />,
      danger: true,
      run: ([w]) =>
        openDialog({
          type: 'confirm',
          title: 'Remove worktree?',
          body: `git worktree remove ${w.kind === 'worktree' ? w.data.path : ''}. Uncommitted changes are lost.`,
          confirm: 'Remove',
          danger: true,
          onConfirm: () => {
            removeItems([w.id]);
            toast('Worktree removed', w.title);
          },
        }),
    },
  ],

  complete: () => ({}),

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
          baseBranch: proj?.data.defaultBranch ?? 'main',
          ticketKey: v.match(/[A-Z][A-Z0-9]+-\d+/)?.[0],
          git: { ahead: 0, behind: 0, dirty: false, changedFiles: 0 },
        },
      };
    },
  },
};
