/** UI actions of the worktree kind: create PR (optionally stacked), launch app, run tests, remove. */
import { gitOps } from '../../data/git';
import { appOps } from '../../data/apps';
import { ghOps } from '../../data/gh';
import { jiraUrl } from '../../data/jira';
import { testOps } from '../../data/tests';
import type { Item, ItemOf } from '../../domain';
import { place } from '../../layout';
import { native } from '../../native';
import { addItem, addLink, getState, inspect, makeItem, patchData, removeItems, select } from '../../store';
import { openForm, str } from '../../ui/form';
import { errorText, runTask } from '../../ui/task';
import { archive, toast } from '../common';
import type { KindCtx } from '../types';
import { appRequest, defaultPrBody, defaultPrTitle, isAbsolutePath, prBase, stackCandidates, testRequest, type PrFormValues } from './model';

type Worktree = ItemOf<'worktree'>;

const ticketOf = (w: Worktree, ctx: KindCtx) =>
  ctx.linked(w.id, 'ticket')[0] ?? (w.data.ticketKey ? ctx.items.find((i): i is ItemOf<'ticket'> => i.kind === 'ticket' && i.data.key === w.data.ticketKey) : undefined);

/** Create PR: push the branch, `gh pr create`, then a `pr` item linked to the worktree, the ticket and the parent PR. */
export async function createPr(w: Worktree, ctx: KindCtx) {
  const project = ctx.projectOf(w);
  if (!project) return;
  const ticket = ticketOf(w, ctx);
  const prs = stackCandidates(ctx.inProject(project.id, 'pr'), w);
  await openForm({
    title: 'Create pull request',
    description: `${w.data.branch} → ${w.data.baseBranch} in ${project.data.repo}. The branch is pushed to origin first.`,
    submitLabel: 'Push & create PR',
    values: { title: defaultPrTitle(w, ticket), body: defaultPrBody(w, ticket, jiraUrl), base: w.data.baseBranch, draft: false, stackOn: '' },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Description', type: 'textarea', rows: 6 },
      ...(prs.length
        ? [
            {
              name: 'stackOn',
              label: 'Stack on PR',
              type: 'select' as const,
              hint: "Uses that PR's branch as the base and links the two.",
              options: [{ value: '', label: 'None' }, ...prs.map((p) => ({ value: p.id, label: `#${p.data.number} ${p.title}` }))],
            },
          ]
        : []),
      { name: 'base', label: 'Base branch', type: 'text', required: true, when: (v) => !str(v, 'stackOn') },
      { name: 'draft', label: 'Open as draft', type: 'checkbox' },
    ],
    onSubmit: async (v) => {
      const form: PrFormValues = { title: str(v, 'title'), body: str(v, 'body'), base: str(v, 'base'), draft: v.draft === true, stackOn: str(v, 'stackOn') };
      const parent = prs.find((p) => p.id === form.stackOn);
      const base = prBase(form, prs);
      await gitOps.push(w.data.path, { setUpstream: true });
      const { number, url } = await ghOps.prCreate({ dir: w.data.path, repo: project.data.repo, title: form.title.trim(), body: form.body, base, head: w.data.branch, draft: form.draft || undefined });
      const existing = getState().items.find((i) => i.kind === 'pr' && i.data.repo === project.data.repo && i.data.number === number);
      const links = [
        { from: '', to: w.id, label: 'from branch' },
        ...(ticket ? [{ from: '', to: ticket.id, label: 'implements' }] : []),
        ...(parent ? [{ from: '', to: parent.id, label: 'stacked on' }] : []),
      ];
      let id = existing?.id;
      if (existing) {
        patchData<'pr'>(existing.id, { headBranch: w.data.branch, baseBranch: base, isDraft: form.draft, stackedOn: parent?.id });
        for (const l of links) addLink(existing.id, l.to, l.label);
      } else {
        const item = makeItem({
          kind: 'pr',
          handle: `PR-${number}`,
          title: form.title.trim(),
          projectId: project.id,
          data: { repo: project.data.repo, number, headBranch: w.data.branch, baseBranch: base, state: 'open', isDraft: form.draft, reviewDecision: 'REVIEW_REQUIRED', checks: { state: 'pending' }, stackedOn: parent?.id },
        });
        place.seed(item.id, place.near(w.id));
        addItem(
          item,
          links.map((l) => ({ ...l, from: item.id })),
        );
        id = item.id;
      }
      if (id) select([id]);
      toast(`PR #${number} created`, url);
    },
  });
}

/** Existing item of `kind` bound to this worktree (linked, or by `worktreeId`). */
function boundItem<K extends 'app' | 'testrun'>(w: Worktree, ctx: KindCtx, kind: K): ItemOf<K> | undefined {
  const linked = (ctx.linked(w.id, kind) as Item[]).find((i) => !i.archived);
  if (linked) return linked as ItemOf<K>;
  return ctx.items.find((i) => i.kind === kind && !i.archived && 'worktreeId' in i.data && i.data.worktreeId === w.id) as ItemOf<K> | undefined;
}

/** Start the project's start command in the worktree; creates / reuses the `app` item (runner id = item id). */
export async function launchApp(w: Worktree, ctx: KindCtx) {
  const project = ctx.projectOf(w);
  const command = project?.data.startCommand;
  if (!project || !command) return;
  const existing = boundItem(w, ctx, 'app');
  if (existing && (existing.data.state === 'running' || existing.data.state === 'starting')) {
    inspect(existing.id);
    select([existing.id]);
    toast('Already running', existing.title, 'info');
    return;
  }
  const item =
    existing ??
    makeItem({
      kind: 'app',
      handle: `app/${w.handle.replace(/^wt\//, '')}`,
      title: `${project.title} (${w.data.branch.split('/').pop()})`,
      projectId: project.id,
      data: { command, cwd: w.data.path, state: 'starting', worktreeId: w.id },
    });
  if (!existing) {
    place.seed(item.id, place.near(w.id));
    addItem(item, [{ from: item.id, to: w.id, label: 'runs' }]);
  }
  patchData<'app'>(item.id, { command, cwd: w.data.path, procId: item.id, state: 'starting', worktreeId: w.id });
  const state = await runTask(`Starting ${command}`, appOps.start(appRequest(item.id, w, command)), { success: 'App started', message: command });
  if (!state) {
    if (existing) patchData<'app'>(item.id, { state: 'stopped' });
    else removeItems([item.id]);
    return;
  }
  if (state.url) patchData<'app'>(item.id, { url: state.url });
  select([item.id]);
}

/** Run the project's test command in the worktree; creates / reuses the `testrun` item. */
export async function runTests(w: Worktree, ctx: KindCtx) {
  const project = ctx.projectOf(w);
  const command = project?.data.testCommand;
  if (!project || !command) return;
  const existing = boundItem(w, ctx, 'testrun');
  if (existing?.data.state === 'running') {
    inspect(existing.id);
    select([existing.id]);
    toast('Tests are already running', existing.title, 'info');
    return;
  }
  const item =
    existing ??
    makeItem({
      kind: 'testrun',
      handle: `tests/${w.handle.replace(/^wt\//, '')}`,
      title: `${command} · ${w.data.branch.split('/').pop()}`,
      projectId: project.id,
      data: { command, cwd: w.data.path, state: 'running', worktreeId: w.id },
    });
  if (!existing) {
    place.seed(item.id, place.near(w.id));
    addItem(item, [{ from: item.id, to: w.id, label: 'tests' }]);
  }
  patchData<'testrun'>(item.id, { command, cwd: w.data.path, procId: item.id, state: 'running', summary: undefined, outputTail: undefined, startedAt: Date.now(), endedAt: undefined, worktreeId: w.id });
  const state = await runTask(`Running ${command}`, testOps.run(testRequest(item.id, w, command)), { quiet: true });
  if (!state) {
    if (existing) patchData<'testrun'>(item.id, { state: 'stopped' });
    else removeItems([item.id]);
    return;
  }
  toast('Tests started', command, 'info');
  select([item.id]);
}

/** Remove: confirm form ("force" when dirty), `git worktree remove` in the base checkout, then archive the item. */
export async function removeWorktree(w: Worktree, ctx: KindCtx) {
  const project = ctx.projectOf(w);
  const real = isAbsolutePath(w.data.path) && isAbsolutePath(project?.data.baseDir);
  let dirtyFiles = 0;
  if (real) {
    try {
      dirtyFiles = (await native.git.status(w.data.path)).files.filter((f) => f.kind !== 'ignored').length;
    } catch {
      dirtyFiles = w.data.git?.changedFiles ?? 0;
    }
  } else dirtyFiles = w.data.git?.changedFiles ?? 0;
  await openForm({
    title: 'Remove worktree?',
    description: real ? `git worktree remove ${w.data.path}. The branch ${w.data.branch} is kept.` : 'This worktree has no checkout on disk; it is only archived on the canvas.',
    submitLabel: 'Remove',
    danger: true,
    fields: [
      {
        name: 'force',
        label: `Force: discard ${dirtyFiles} uncommitted file${dirtyFiles === 1 ? '' : 's'}`,
        type: 'checkbox',
        hint: 'git refuses to remove a worktree with changes unless forced.',
        when: () => real && dirtyFiles > 0,
      },
    ],
    onSubmit: async (v) => {
      if (real) {
        try {
          await gitOps.worktreeRemove(project!.data.baseDir!, w.data.path, { force: v.force === true });
        } catch (e) {
          throw new Error(errorText(e));
        }
      }
      archive([w], 'Removed');
    },
  });
}
