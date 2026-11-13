/**
 * Selection-level actions and the chat box "send". Per-kind actions live in the kind
 * modules (`kinds/<kind>/index.tsx`); `actionsForItem` (registry) combines them with the shared ones.
 */
import { showToast } from '@dynatrace/strato-components/notifications';
import { ChatIcon, LinkIcon } from '@dynatrace/strato-icons';
import type { Item, Kind } from './domain';
import { place } from './layout';
import { archive, archiveAction, removeAction, skill, toast, unarchiveAction } from './kinds/common';
import { actionsForItem, ctxOf, KINDS, getKind } from './kinds/registry';
import type { Action } from './kinds/types';
import { addItem, addLink, getState, insertSkill, itemById, newId, notify, patchData, select } from './store';

export type { Action, ActionKind } from './kinds/types';
export { actionsForItem } from './kinds/registry';

/** Actions that act on a whole multi-selection. */
function multiActions(items: Item[]): Action[] {
  const kinds = new Set(items.map((i) => i.kind));
  const out: Action[] = [skill('ask', 'Ask about these', '', { icon: <ChatIcon />, primary: true, run: (xs) => insertSkill(null, xs.map((x) => x.id)) })];
  if (kinds.has('ticket')) out.push(skill('plan-multi', 'Plan together', 'plan-ticket'));
  if (kinds.size === 1 && kinds.has('pr')) out.push(skill('review-multi', 'Review all', 'review-pr'));
  if (kinds.size === 1 && kinds.has('build')) out.push(skill('fix-multi', 'Fix all builds', 'fix-ci'));
  out.push(skill('summary', 'Status summary', 'status-summary'));
  if (items.every((i) => i.archived)) return [unarchiveAction, out[0]];
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
  if (items.length === 1) return { items, actions: actionsForItem(items[0], ctxOf()) };
  return { items, actions: multiActions(items) };
}

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
  brainstorm: 'Brainstorm',
};

/** Starting an agent from the chat box spawns a new agent bubble next to what it is about. */
export function sendPrompt(text: string, mentioned: string[]) {
  const sk = text.match(/^\/([\w-]+)/)?.[1];
  const subject = mentioned.map(itemById).find(Boolean);
  const title = `${sk ? (AGENT_TITLE[sk] ?? sk) : 'Chat'}${subject ? ` ${subject.handle}` : ''}`;
  const id = newId('a');
  const at = subject ? place.near(subject.id) : place.center();
  const cwd = subject?.kind === 'worktree' ? subject.data.path : subject ? (ctxOf().projectOf(subject)?.data.baseDir ?? '') : '';
  addItem(
    {
      id,
      kind: 'agent',
      handle: `agent/${(sk ?? 'chat') + (subject ? '-' + subject.handle.replace(/[^\w]/g, '').toLowerCase().slice(-6) : '')}`,
      title,
      projectId: subject?.kind === 'project' ? subject.id : subject?.projectId,
      data: { cwd, model: 'claude-opus-5-5', status: 'running', skill: sk, lastActivity: 'reading context', startedAt: Date.now(), usage: { contextPct: 2, costUsd: 0, turns: 0 } },
    },
    mentioned.map((m) => ({ from: id, to: m, label: 'about' })),
  );
  place.seed(id, at);
  select([id], false, { mention: false });
  showToast({ type: 'info', title: 'Agent started', message: text.length > 90 ? text.slice(0, 90) + '…' : text, lifespan: 3000 });
  // prototype: the agent "finishes" a little later and raises a notification (phase 1 wires the claude CLI)
  setTimeout(() => {
    const a = itemById(id);
    if (!a || a.kind !== 'agent' || a.archived || a.data.status !== 'running') return;
    patchData<'agent'>(a, { status: 'done', lastActivity: 'waiting for review', endedAt: Date.now() });
    notify(id, { text: `${title} finished — ready for your review`, tone: 'success' });
  }, 14000 + Math.random() * 8000);
  return id;
}

/** Kinds that can be added from the canvas menu / add dialog, in display order. */
export const KINDS_ADDABLE: { kind: Kind; label: string; hint: string }[] = KINDS.flatMap((k) => {
  const a = getKind(k).addable;
  return a ? [{ kind: k, label: a.label, hint: a.hint }] : [];
});

/** Items linked to the given ones (not themselves). */
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
  const items = getState()
    .selected.map(itemById)
    .filter((i): i is Item => !!i);
  if (items.length) removeAction.run(items);
}
