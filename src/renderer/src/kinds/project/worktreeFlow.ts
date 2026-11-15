/**
 * "New worktree": a form (branch, base, optional ticket, path), `git worktree add`, then a linked
 * `worktree` bubble. Used by the project action and the ticket's "Create worktree"; the sidebar's
 * "add to canvas" for worktrees that exist on disk uses `addWorktreeBubble` directly.
 */
import { userConfig } from '../../data/config';
import { gitOps } from '../../data/git';
import type { ItemOf } from '../../domain';
import { place } from '../../layout';
import { addItem, getState, makeItem, patchData, select } from '../../store';
import { openForm, str } from '../../ui/form';
import { toast } from '../common';
import { openProjectSettings } from './settings';
import { ticketKeyOf } from '../../../../shared/util';
import { branchForTicket, defaultWorktreePath, hasBaseDir, SET_BASE_HINT, worktreeAddArgs, worktreeHandle } from './worktreeModel';

type Project = ItemOf<'project'>;
type Ticket = ItemOf<'ticket'>;

const NO_TICKET = 'none';

export const ticketsOf = (projectId: string): Ticket[] =>
  getState().items.filter((i): i is Ticket => i.kind === 'ticket' && i.projectId === projectId && !i.archived);

/** The ticket matching a branch name (by Jira key), among a project's tickets. */
export const ticketForBranch = (projectId: string, branch: string): Ticket | undefined => {
  const key = ticketKeyOf(branch);
  return key ? ticketsOf(projectId).find((t) => t.data.key === key) : undefined;
};

/** Create the worktree bubble (and link it to its ticket). No git involved. */
export function addWorktreeBubble(project: Project, w: { path: string; branch: string; baseBranch: string; ticket?: Ticket }): ItemOf<'worktree'> {
  const taken = getState().items.map((i) => i.handle);
  const item = makeItem({
    kind: 'worktree',
    handle: worktreeHandle(w.branch, taken),
    title: w.branch,
    projectId: project.id,
    data: { path: w.path, branch: w.branch, baseBranch: w.baseBranch, ...(w.ticket ? { ticketKey: w.ticket.data.key } : {}) },
  }) as ItemOf<'worktree'>;
  place.seed(item.id, place.near(w.ticket?.id ?? project.id));
  addItem(item, w.ticket ? [{ from: item.id, to: w.ticket.id, label: 'works on' }] : []);
  if (w.ticket && w.ticket.data.branch !== w.branch) patchData<'ticket'>(w.ticket.id, { branch: w.branch });
  return item;
}

/**
 * Open the form. `ticket` prefills branch (`<KEY>-<slug>`) and the ticket picker.
 * Resolves with the new bubble (null when cancelled).
 */
export async function openNewWorktree(project: Project, opts: { ticket?: Ticket } = {}): Promise<ItemOf<'worktree'> | null> {
  if (!hasBaseDir(project.data)) {
    toast(SET_BASE_HINT, project.title, 'warning');
    await openProjectSettings(project);
    return null;
  }
  const tickets = ticketsOf(project.id);
  if (opts.ticket && !tickets.some((t) => t.id === opts.ticket!.id)) tickets.push(opts.ticket);
  const byId = (id: string) => tickets.find((t) => t.id === id);
  const { branchTemplate, worktreesDir } = userConfig().git;
  const branchOf = (t: Ticket) => branchForTicket(t.data.key, t.title, branchTemplate);

  const initialBranch = opts.ticket ? branchOf(opts.ticket) : '';
  // the last value we derived: a path the user typed over is left alone
  let autoPath = defaultWorktreePath(project.data, initialBranch, worktreesDir);
  let autoBranch = initialBranch;

  let created = null as ItemOf<'worktree'> | null;
  await openForm({
    title: opts.ticket ? `Create worktree for ${opts.ticket.data.key}` : `New worktree in ${project.title}`,
    description: `Branched from ${project.data.defaultBranch} in ${project.data.baseDir}.`,
    submitLabel: 'Create worktree',
    fields: [
      {
        name: 'ticketId',
        label: 'Ticket',
        type: 'select',
        options: [{ value: NO_TICKET, label: 'No ticket' }, ...tickets.map((t) => ({ value: t.id, label: `${t.data.key}: ${t.title}` }))],
        hint: 'Prefills the branch and links the worktree to the ticket.',
      },
      { name: 'branch', label: 'Branch', type: 'text', required: true, placeholder: 'CTX-123-short-description' },
      { name: 'base', label: 'Base branch', type: 'text', required: true },
      { name: 'newBranch', label: 'Create the branch (untick to check out an existing one)', type: 'checkbox' },
      { name: 'path', label: 'Path', type: 'directory', required: true, hint: 'Defaults to <worktrees folder>/<branch>.' },
    ],
    values: {
      ticketId: opts.ticket?.id ?? NO_TICKET,
      branch: initialBranch,
      base: project.data.defaultBranch,
      newBranch: true,
      path: autoPath,
    },
    onChange: (name, v) => {
      if (name === 'ticketId') {
        const t = byId(str(v, 'ticketId'));
        if (!t || (str(v, 'branch') && str(v, 'branch') !== autoBranch)) return;
        autoBranch = branchOf(t);
        const patch: Record<string, string> = { branch: autoBranch };
        if (!str(v, 'path') || str(v, 'path') === autoPath) patch.path = autoPath = defaultWorktreePath(project.data, autoBranch, worktreesDir);
        return patch;
      }
      if (name === 'branch' && (!str(v, 'path') || str(v, 'path') === autoPath)) {
        autoPath = defaultWorktreePath(project.data, str(v, 'branch'), worktreesDir);
        return { path: autoPath };
      }
    },
    onSubmit: async (v) => {
      const args = worktreeAddArgs(project.data, { branch: str(v, 'branch'), base: str(v, 'base'), path: str(v, 'path'), newBranch: v.newBranch === true });
      await gitOps.worktreeAdd(args.repoDir, args.path, args.branch, args.base, { newBranch: args.newBranch });
      const ticket = byId(str(v, 'ticketId')) ?? ticketForBranch(project.id, args.branch);
      created = addWorktreeBubble(project, { path: args.path, branch: args.branch, baseBranch: args.base ?? project.data.defaultBranch, ticket });
      select([created.id]);
      toast('Worktree created', `${args.branch} · ${args.path}`);
    },
  });
  return created;
}
