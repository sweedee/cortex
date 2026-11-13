/**
 * Quick actions per bubble kind. Most actions only insert a skill into the chat box
 * (`skill`); the rest open something (`external`, `view`) or change something (`direct`).
 */
import type { ReactElement } from 'react';
import { dismissToast, showToast } from '@dynatrace/strato-components/notifications';
import {
  CheckmarkIcon,
  CycleIcon,
  DeleteIcon,
  ExternalLinkIcon,
  LinkIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  ViewIcon,
  ChatIcon,
  SuccessIcon,
  UndoIcon,
  DescriptionIcon,
  TerminalIcon,
} from '@dynatrace/strato-icons';
import type { Item, Kind } from './model';
import { ArchiveIcon, skillIcon } from './visual';
import { Button } from '@dynatrace/strato-components/buttons';
import {
  addItem,
  addLink,
  getState,
  insertSkill,
  itemById,
  newId,
  openDialog,
  patchItem,
  notify,
  removeItems,
  select,
  setArchived,
} from './store';
import { place } from './layout';

export type ActionKind = 'skill' | 'external' | 'direct' | 'view';

export interface Action {
  id: string;
  label: string;
  type: ActionKind;
  icon: ReactElement;
  /** the skill inserted into the chat box (type 'skill') */
  skill?: string;
  /** shown first / emphasised */
  primary?: boolean;
  danger?: boolean;
  /** reason it is disabled */
  disabled?: string;
  run: (items: Item[]) => void;
}

const skill = (id: string, label: string, name: string, extra: Partial<Action> = {}): Action => ({
  id,
  label,
  type: 'skill',
  skill: name,
  icon: skillIcon(name),
  run: (items) => insertSkill(name, items.map((i) => i.id)),
  ...extra,
});

const external = (id: string, label: string, url: (i: Item) => string): Action => ({
  id,
  label,
  type: 'external',
  icon: <ExternalLinkIcon />,
  run: (items) =>
    showToast({ type: 'info', title: `Opening ${label.replace(/^Open (in )?/i, '')}`, message: url(items[0]) + ' (mock)', lifespan: 2500 }),
});

const toast = (title: string, message?: string, type: 'info' | 'success' | 'warning' | 'critical' = 'success') =>
  showToast({ type, title, message, lifespan: 3000 });

const gh = (i: Item) => `github.com/ctx-observability/${repoOf(i)}/pull/${i.short?.replace('#', '')}`;
const repoOf = (i: Item) => i.subtitle?.split(' ')[0] ?? 'repo';

// ---- complete / archive --------------------------------------------------------------

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

/** Archive with an undo button on the toast. */
function archive(items: Item[], patch?: (i: Item) => Partial<Item>, verb = 'Archived') {
  const before = items.map((i) => ({ id: i.id, status: i.status, flags: i.flags, subtitle: i.subtitle }));
  items.forEach((i) => setArchived([i.id], true, patch?.(i) ?? {}));
  const toastId = showToast({
    type: 'success',
    title: `${verb} ${items.length === 1 ? items[0].handle : plural(items.length, 'item')}`,
    message: 'Show archived items in the filter to find it again.',
    lifespan: 5000,
    actions: (
      <Button
        size="condensed"
        onClick={() => {
          before.forEach((b) => setArchived([b.id], false, { status: b.status, flags: b.flags, subtitle: b.subtitle }));
          select(before.map((b) => b.id));
          dismissToast(toastId);
        }}
      >
        <Button.Prefix>
          <UndoIcon />
        </Button.Prefix>
        Undo
      </Button>
    ),
  });
}

const DONE_LABEL: Partial<Record<Kind, string>> = { ticket: 'Done', agent: 'Completed', plan: 'Implemented', pr: 'Closed', worktree: 'Finished' };

const completeAction = (kind: Kind): Action => ({
  id: 'complete',
  label: kind === 'agent' ? 'Complete' : 'Mark done',
  type: 'direct',
  icon: <SuccessIcon />,
  run: (items) =>
    archive(
      items,
      (i) => ({ status: [{ tone: 'success', label: DONE_LABEL[i.kind] ?? 'Done' }], flags: { ...i.flags, running: false, waitingForInput: false } }),
      'Completed',
    ),
});

const archiveAction: Action = { id: 'archive', label: 'Archive', type: 'direct', icon: <ArchiveIcon />, run: (items) => archive(items) };

const restoreAction: Action = {
  id: 'unarchive',
  label: 'Unarchive',
  type: 'direct',
  icon: <UndoIcon />,
  primary: true,
  run: (items) => {
    setArchived(
      items.map((i) => i.id),
      false,
    );
    toast(`Restored ${items.length === 1 ? items[0].handle : plural(items.length, 'item')}`, undefined, 'info');
  },
};

/** Kinds that can be "done" (rather than only put away). */
const COMPLETABLE: Kind[] = ['ticket', 'agent', 'plan', 'worktree'];

/** All actions of one item, primary first. Archived items can only be looked at or restored. */
export function actionsForItem(item: Item): Action[] {
  if (item.archived) return [restoreAction, ...actionsFor(item).filter((a) => a.type === 'view' || a.type === 'external')];
  const extra: Action[] = [];
  if (COMPLETABLE.includes(item.kind)) extra.push(completeAction(item.kind));
  extra.push(archiveAction);
  return sortActions([...actionsFor(item), ...extra]);
}

function actionsFor(item: Item): Action[] {
  switch (item.kind) {
    case 'project':
      return [
        skill('plan-feature', 'Plan a feature', 'plan-feature', { primary: true }),
        skill('triage', 'Triage tickets', 'triage-tickets'),
        skill('renovate', 'Review Renovate PRs', 'review-renovate'),
        {
          id: 'new-wt',
          label: 'New worktree',
          type: 'direct',
          icon: <PlusIcon />,
          run: ([p]) => openDialog({ type: 'add', kind: 'worktree', at: place.near(p.id) }),
        },
        external('repo', 'Open repo', (i) => `github.com/${i.subtitle}`),
      ];
    case 'ticket':
      return [
        skill('plan', 'Plan', 'plan-ticket', { primary: item.status[0].tone === 'neutral' || item.status[0].tone === 'critical' }),
        skill('implement', 'Implement', 'implement', { primary: item.status[0].tone === 'primary' }),
        skill('refine', 'Refine ticket', 'refine-ticket'),
        {
          id: 'start',
          label: 'Create worktree',
          type: 'direct',
          icon: <PlusIcon />,
          run: ([t]) => openDialog({ type: 'add', kind: 'worktree', at: place.near(t.id) }),
        },
        external('jira', 'Open in Jira', (i) => `jira.ctx.internal/browse/${i.handle}`),
      ];
    case 'worktree':
      return [
        skill('implement', 'Implement', 'implement', { primary: true }),
        skill('self-review', 'Self-review', 'self-review'),
        skill('create-pr', 'Create PR', 'create-pr'),
        {
          id: 'rebase',
          label: 'Rebase on main',
          type: 'direct',
          icon: <CycleIcon />,
          run: ([w]) => {
            patchItem(w.id, { status: [{ tone: 'success', label: 'rebased, up to date with main' }] });
            toast('Rebased on main', w.title);
          },
        },
        {
          id: 'ide',
          label: 'Open in IDE',
          type: 'external',
          icon: <TerminalIcon />,
          run: ([w]) => toast('Opening in IntelliJ', w.subtitle, 'info'),
        },
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
              body: `git worktree remove ${w.subtitle}. Uncommitted changes are lost.`,
              confirm: 'Remove',
              danger: true,
              onConfirm: () => {
                removeItems([w.id]);
                toast('Worktree removed', w.title);
              },
            }),
        },
      ];
    case 'agent': {
      const waiting = item.flags?.waitingForInput;
      const running = item.flags?.running;
      return [
        { id: 'view', label: waiting ? 'Answer' : 'View session', type: 'view', icon: <ViewIcon />, primary: true, run: ([a]) => openDialog({ type: 'session', itemId: a.id }) },
        skill('continue', 'Continue', 'continue-session'),
        skill('fork', 'Fork session', 'fork-session'),
        running
          ? {
              id: 'stop',
              label: 'Stop',
              type: 'direct',
              icon: <StopIcon />,
              danger: true,
              run: ([a]) => {
                patchItem(a.id, { flags: { ...a.flags, running: false }, status: [{ tone: 'neutral', label: 'Stopped by you' }] });
                toast('Agent stopped', a.title, 'info');
              },
            }
          : {
              id: 'resume',
              label: 'Resume',
              type: 'direct',
              icon: <PlayIcon />,
              disabled: waiting ? 'Answer the question first' : undefined,
              run: ([a]) => {
                patchItem(a.id, { flags: { ...a.flags, running: true }, status: [{ tone: 'running', label: 'Running' }] });
                toast('Agent resumed', a.title, 'info');
              },
            },
      ];
    }
    case 'pr': {
      const mergeable = item.flags?.mergeable;
      const conflicted = item.status.some((s) => /conflict/i.test(s.label));
      return [
        external('github', 'Open in GitHub', gh),
        {
          id: 'merge',
          label: 'Merge',
          type: 'direct',
          icon: <CheckmarkIcon />,
          primary: mergeable,
          disabled: mergeable ? undefined : conflicted ? 'Has merge conflicts' : 'Not approved or checks not green',
          run: ([pr]) =>
            openDialog({
              type: 'confirm',
              title: `Merge ${pr.short}?`,
              body: `Squash-merge “${pr.title}” into main and delete the branch.`,
              confirm: 'Squash and merge',
              onConfirm: () => {
                patchItem(pr.id, { status: [{ tone: 'success', label: 'Merged' }], flags: { ...pr.flags, mergeable: false }, subtitle: pr.subtitle?.replace(/·.*/, '· merged') });
                toast(`${pr.short} merged`, pr.title);
              },
            }),
        },
        ...(conflicted ? [skill('conflicts', 'Resolve conflicts', 'resolve-conflicts', { primary: true })] : []),
        skill('address', 'Address review', 'address-review'),
        skill('review', 'Review PR', 'review-pr'),
        skill('describe', 'Write description', 'describe-pr'),
      ];
    }
    case 'build': {
      const failed = item.status[0].tone === 'critical';
      return [
        ...(failed ? [skill('fix-ci', 'Fix CI', 'fix-ci', { primary: true })] : []),
        { id: 'log', label: 'View log', type: 'view', icon: <DescriptionIcon />, primary: !failed, run: ([b]) => openDialog({ type: 'log', itemId: b.id }) },
        skill('explain', 'Explain failure', 'explain-build', { disabled: failed ? undefined : 'Build did not fail' }),
        {
          id: 'rerun',
          label: 'Re-run',
          type: 'direct',
          icon: <CycleIcon />,
          run: ([b]) => {
            patchItem(b.id, { status: [{ tone: 'running', label: 'Running · queued' }], flags: { running: true }, notice: undefined });
            toast('Build re-triggered', b.title, 'info');
          },
        },
        external('jenkins', 'Open in Jenkins', (i) => `ci.ctx.internal/job/${i.title.replace(' #', '/')}`),
      ];
    }
    case 'plan': {
      const approved = item.facts?.find(([k]) => k === 'Approved')?.[1] === 'yes';
      return [
        { id: 'view', label: 'View plan', type: 'view', icon: <ViewIcon />, primary: true, run: ([p]) => openDialog({ type: 'plan', itemId: p.id }) },
        skill('implement-plan', 'Implement plan', 'implement-plan', { disabled: approved ? undefined : 'Approve the plan first' }),
        skill('grill', 'Grill the plan', 'grill-plan'),
        ...(!approved
          ? [
              {
                id: 'approve',
                label: 'Approve',
                type: 'direct' as const,
                icon: <CheckmarkIcon />,
                run: ([p]: Item[]) => {
                  patchItem(p.id, {
                    status: [{ tone: 'success', label: 'Approved' }],
                    subtitle: 'Approved · 9 steps',
                    facts: p.facts?.map(([k, v]) => (k === 'Approved' ? [k, 'yes'] : [k, v])) as [string, string][],
                  });
                  toast('Plan approved', p.title);
                },
              },
            ]
          : []),
      ];
    }
  }
}

/** Actions that act on a whole multi-selection. */
function multiActions(items: Item[]): Action[] {
  const kinds = new Set(items.map((i) => i.kind));
  const out: Action[] = [
    skill('ask', 'Ask about these', '', { icon: <ChatIcon />, primary: true, run: (xs) => insertSkill(null, xs.map((x) => x.id)) }),
  ];
  if (kinds.has('ticket')) out.push(skill('plan-multi', 'Plan together', 'plan-ticket'));
  if (kinds.size === 1 && kinds.has('pr')) out.push(skill('review-multi', 'Review all', 'review-pr'));
  if (kinds.size === 1 && kinds.has('build')) out.push(skill('fix-multi', 'Fix all builds', 'fix-ci'));
  out.push(skill('summary', 'Status summary', 'status-summary'));
  if (items.every((i) => i.archived)) return [restoreAction, out[0]];
  if (items.length === 2) {
    out.push({
      id: 'link',
      label: 'Link',
      type: 'direct',
      icon: <LinkIcon />,
      run: ([a, b]) => {
        addLink(a.id, b.id, 'related to');
        toast('Linked', `${a.handle} ↔ ${b.handle}`);
      },
    });
  }
  out.push({ ...archiveAction, label: 'Archive all', run: (xs) => archive(xs.filter((x) => !x.archived)) });
  return out;
}

export function actionsForSelection(ids: string[]): { items: Item[]; actions: Action[] } {
  const items = ids.map(itemById).filter((i): i is Item => !!i);
  if (items.length === 0) return { items, actions: [] };
  if (items.length === 1) return { items, actions: actionsForItem(items[0]) };
  return { items, actions: multiActions(items) };
}

const sortActions = (as: Action[]) => [...as].sort((a, b) => Number(!!b.primary && !b.disabled) - Number(!!a.primary && !a.disabled));

// ---- sending the chat box ---------------------------------------------------------

const AGENT_TITLE: Record<string, string> = {
  'plan-ticket': 'Plan',
  implement: 'Implement',
  'fix-ci': 'Fix CI',
  'review-pr': 'Review',
  'self-review': 'Self-review',
  'address-review': 'Address review',
  'resolve-conflicts': 'Resolve conflicts',
  'create-pr': 'Create PR',
  'grill-plan': 'Grill plan',
  'implement-plan': 'Implement plan',
};

/** Starting an agent from the chat box spawns a new agent bubble next to what it is about. */
export function sendPrompt(text: string, mentioned: string[]) {
  const sk = text.match(/^\/([\w-]+)/)?.[1];
  const subject = mentioned.map(itemById).find(Boolean);
  const title = `${sk ? (AGENT_TITLE[sk] ?? sk) : 'Chat'}${subject ? ` ${subject.handle}` : ''}`;
  const id = newId('a');
  const cluster = subject?.cluster;
  const at = subject ? place.near(subject.id) : place.center();
  addItem(
    {
      id,
      kind: 'agent',
      handle: `agent/${(sk ?? 'chat') + (subject ? '-' + subject.handle.replace(/[^\w]/g, '').toLowerCase().slice(-6) : '')}`,
      title,
      subtitle: 'claude-opus-5-5 · just started',
      status: [{ tone: 'running', label: 'Running · reading context' }],
      flags: { running: true },
      facts: [['Context', '2%'], ['Cost', '$0.00'], ['Turns', '0']],
      cluster,
    },
    mentioned.map((m) => ({ from: id, to: m, label: 'about' })),
  );
  place.seed(id, at);
  select([id], false, { mention: false });
  showToast({ type: 'info', title: 'Agent started', message: text.length > 90 ? text.slice(0, 90) + '…' : text, lifespan: 3000 });
  // prototype: the agent "finishes" a little later and raises a notification
  setTimeout(() => {
    const a = itemById(id);
    if (!a || a.archived || !a.flags?.running) return;
    notify(
      id,
      { text: `${title} finished — ready for your review`, tone: 'success', ago: 0 },
      { status: [{ tone: 'success', label: 'Done · waiting for review' }], flags: { ...a.flags, running: false }, subtitle: 'claude-opus-5-5 · finished' },
    );
  }, 14000 + Math.random() * 8000);
  return id;
}

export const KINDS_ADDABLE: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'ticket', label: 'Import Jira ticket…', hint: 'CTX-1234 or a Jira URL' },
  { kind: 'pr', label: 'Import pull request…', hint: 'owner/repo#123 or a GitHub URL' },
  { kind: 'project', label: 'Add project…', hint: 'owner/repo' },
  { kind: 'worktree', label: 'Create worktree…', hint: 'branch name, e.g. feat/CTX-1234-thing' },
  { kind: 'agent', label: 'Start agent session…', hint: 'what should the agent do?' },
  { kind: 'plan', label: 'New plan file…', hint: 'file name, e.g. PLAN-CTX-1234.md' },
  { kind: 'build', label: 'Watch CI build…', hint: 'job/branch, e.g. console-ui/main' },
];

/** Items linked to the given ones (not themselves), lowest level first. */
export function relatedItems(ids: string[]): Item[] {
  const { links } = getState();
  const set = new Set(ids);
  const out = new Set<string>();
  for (const l of links) {
    if (set.has(l.from) && !set.has(l.to)) out.add(l.to);
    if (set.has(l.to) && !set.has(l.from)) out.add(l.from);
  }
  return [...out].map(itemById).filter((i): i is Item => !!i);
}

/** Delete-key handler. */
export function removeSelected() {
  const ids = getState().selected;
  if (ids.length === 0) return;
  removeItems(ids);
  showToast({ type: 'info', title: `Removed ${ids.length} bubble${ids.length > 1 ? 's' : ''} from the canvas`, message: 'Only from the canvas; nothing was deleted.', lifespan: 2500 });
}
