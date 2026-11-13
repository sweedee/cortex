/**
 * Building blocks for kind actions, and the shared actions every kind gets
 * (complete, archive, unarchive, remove). Must not import the registry (kind modules import this).
 */
import type { ReactElement } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { dismissToast, showToast } from '@dynatrace/strato-components/notifications';
import { DeleteIcon, ExternalLinkIcon, SuccessIcon, UndoIcon } from '@dynatrace/strato-icons';
import type { Item } from '../domain';
import { insertSkill, patchData, removeItems, restoreItems, select, setArchived } from '../store';
import { ArchiveIcon, skillIcon } from './icons';
import type { Action, KindModule } from './types';

export type ToastType = 'info' | 'success' | 'warning' | 'critical';

export const toast = (title: string, message?: string, type: ToastType = 'success') => showToast({ type, title, message, lifespan: 3000 });

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "@handle" for one item, "3 items" for several. */
export const nameOf = (items: Item[]) => (items.length === 1 ? items[0].handle : plural(items.length, 'item'));

/** An AI action: inserts `/name @item…` into the chat box (the skill need not exist yet). */
export function skill(id: string, label: string, name: string, extra: Partial<Action> = {}): Action {
  return {
    id,
    label,
    type: 'skill',
    skill: name,
    icon: skillIcon(name),
    run: (items) =>
      insertSkill(
        name,
        items.map((i) => i.id),
      ),
    ...extra,
  };
}

/** Opens something outside Cortex (mocked as a toast until the integration lands). */
export function external(id: string, label: string, url: (i: Item) => string, extra: Partial<Action> = {}): Action {
  return {
    id,
    label,
    type: 'external',
    icon: <ExternalLinkIcon />,
    run: (items) => showToast({ type: 'info', title: `Opening ${label.replace(/^Open (in )?/i, '')}`, message: url(items[0]) + ' (mock)', lifespan: 2500 }),
    ...extra,
  };
}

/** A UI action that exists in the design but is not built yet: shows a toast. */
export function placeholder(id: string, label: string, icon: ReactElement, extra: Partial<Action> = {}): Action {
  return {
    id,
    label,
    type: 'direct',
    icon,
    run: () => toast(`${label.replace(/…$/, '')}: not implemented yet`, 'Coming in a later phase.', 'info'),
    ...extra,
  };
}

// ---- complete / archive -----------------------------------------------------------------

/** Archive with an undo button on the toast. `before` runs per item first (e.g. the "done" patch). */
export function archive(items: Item[], verb = 'Archived', before?: (i: Item) => void) {
  const snapshot = items.map((i) => ({ ...i }));
  items.forEach((i) => before?.(i));
  setArchived(
    items.map((i) => i.id),
    true,
  );
  const toastId = showToast({
    type: 'success',
    title: `${verb} ${nameOf(items)}`,
    message: 'Show archived items in the filter to find it again.',
    lifespan: 5000,
    actions: (
      <Button
        size="condensed"
        onClick={() => {
          restoreItems(snapshot);
          select(snapshot.map((b) => b.id));
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

/** "Mark done": the kind's `complete` patch, then archive. Only for kinds that define `complete`. */
export function completeAction(mod: KindModule): Action {
  return {
    id: 'complete',
    label: mod.kind === 'agent' ? 'Complete' : 'Mark done',
    type: 'direct',
    icon: <SuccessIcon />,
    run: (items) => archive(items, 'Completed', (i) => patchData(i.id, (mod.complete as (x: Item) => object)(i))),
  };
}

export const archiveAction: Action = { id: 'archive', label: 'Archive', type: 'direct', icon: <ArchiveIcon />, run: (items) => archive(items) };

export const unarchiveAction: Action = {
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
    toast(`Restored ${nameOf(items)}`, undefined, 'info');
  },
};

/** Take bubbles off the canvas (nothing outside Cortex is deleted). */
export const removeAction: Action = {
  id: 'remove',
  label: 'Remove from canvas',
  type: 'direct',
  icon: <DeleteIcon />,
  run: (items) => {
    removeItems(items.map((i) => i.id));
    showToast({ type: 'info', title: `Removed ${plural(items.length, 'bubble')} from the canvas`, message: 'Only from the canvas; nothing was deleted.', lifespan: 2500 });
  },
};

/** Primary first (enabled ones), otherwise stable. */
export const sortActions = (as: Action[]) => [...as].sort((a, b) => Number(!!b.primary && !b.disabled) - Number(!!a.primary && !a.disabled));
