/**
 * Building blocks for kind actions, and the shared actions every kind gets
 * (complete, archive, unarchive, remove). Must not import the registry (kind modules import this).
 */
import { Button } from '@dynatrace/strato-components/buttons';
import { dismissToast, showToast } from '@dynatrace/strato-components/notifications';
import { CodeIcon, DeleteIcon, ExternalLinkIcon, FolderOpenIcon, SuccessIcon, UndoIcon } from '@dynatrace/strato-icons';
import type { Item, ItemOf, Kind, Segment } from '../domain';
import { insertSkill, itemById, patchData, removeItems, restoreItems, restoreRemoved, select, setArchived } from '../store';
import { openInEditor, openPath, openUrl } from '../ui/task';
import { ArchiveIcon, skillIcon } from './icons';
import type { Action, KindModule } from './types';

// ---- defineKind ----------------------------------------------------------------------------

/** The `KindModule` fields `defineKind` fills in when they are left out. */
type Defaulted = 'radius' | 'ring' | 'facts' | 'subtitle' | 'actions';
export type KindSpec<K extends Kind> = Omit<KindModule<K>, Defaulted> & Partial<Pick<KindModule<K>, Defaulted>>;

/** Default bubble radius (world px) of `defineKind`. */
export const DEFAULT_RADIUS = 28;
const NEUTRAL: Segment[] = [{ tone: 'neutral', label: 'No status' }];

/**
 * A kind module with defaults: radius 28, a neutral ring, no facts, no subtitle, no own actions
 * (*Archive* and, with `complete`, *Mark done* are added by the registry anyway). Required are
 * `kind`, `label`, `icon`, `level` and `describe`, so a small kind is a dozen lines.
 */
export function defineKind<K extends Kind>(spec: KindSpec<K>): KindModule<K> {
  return { radius: DEFAULT_RADIUS, ring: () => NEUTRAL, facts: () => [], subtitle: () => undefined, actions: () => [], ...spec };
}

export type ToastType = 'info' | 'success' | 'warning' | 'critical';

export const toast = (title: string, message?: string, type: ToastType = 'success') => showToast({ type, title, message, lifespan: 3000 });

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The current item with that id, if it (still) has that kind (async jobs re-read it after awaiting). */
export function currentItem<K extends Kind>(id: string, kind: K): ItemOf<K> | undefined {
  const it = itemById(id);
  return it?.kind === kind ? (it as ItemOf<K>) : undefined;
}

// ---- `describe` text (chat box context lines) --------------------------------------------

/** `"title"` with inner double quotes made single. */
export const quoted = (s: string) => `"${s.replace(/"/g, "'")}"`;
/** The first line, cut at `max` characters. */
export const oneLine = (s: string, max = 100) => {
  const l = s.trim().split(/\r?\n/)[0] ?? '';
  return l.length > max ? l.slice(0, max - 1) + '…' : l;
};
/** ` (a, b)` from the parts that are set, or ''. */
export const paren = (parts: (string | undefined | false)[]) => {
  const p = parts.filter(Boolean);
  return p.length ? ` (${p.join(', ')})` : '';
};

/** "@handle" for one item, "3 items" for several. */
export const nameOf = (items: Item[]) => (items.length === 1 && items[0] ? items[0].handle : plural(items.length, 'item'));

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

/** Opens a URL in the OS browser (`https://` is added when missing). Disable it when there is no URL. */
export function external(id: string, label: string, url: (i: Item) => string, extra: Partial<Action> = {}): Action {
  return {
    id,
    label,
    type: 'external',
    icon: <ExternalLinkIcon />,
    run: ([i]) => i && void openUrl(url(i)),
    ...extra,
  };
}

/** Shows a folder / file in the OS file manager. */
export function openPathAction(id: string, label: string, path: (i: Item) => string | undefined, extra: Partial<Action> = {}): Action {
  return { id, label, type: 'external', icon: <FolderOpenIcon />, run: ([i]) => i && void openPath(path(i) ?? ''), ...extra };
}

/** Opens a folder / file in the editor (`code <path>`, falls back to the OS). */
export function openInEditorAction(id: string, label: string, path: (i: Item) => string | undefined, extra: Partial<Action> = {}): Action {
  return { id, label, type: 'external', icon: <CodeIcon />, run: ([i]) => i && void openInEditor(path(i) ?? ''), ...extra };
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
    label: mod.completeLabel ?? 'Mark done',
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

/** Remove bubbles (with their links) and offer "Undo" on the toast. */
export function removeWithUndo(items: Item[]) {
  const snapshot = removeItems(items.map((i) => i.id));
  const toastId = showToast({
    type: 'info',
    title: `Removed ${plural(items.length, 'bubble')} from the canvas`,
    message: 'Only from the canvas; nothing was deleted.',
    lifespan: 6000,
    actions: (
      <Button
        size="condensed"
        onClick={() => {
          restoreRemoved(snapshot);
          select(snapshot.items.map((e) => e.item.id));
          dismissToast(toastId);
        }}
      >
        Undo
      </Button>
    ),
  });
}

/** Take bubbles off the canvas (nothing outside Cortex is deleted). */
export const removeAction: Action = {
  id: 'remove',
  label: 'Remove from canvas',
  type: 'direct',
  icon: <DeleteIcon />,
  run: (items) => removeWithUndo(items),
};

/** Primary first (enabled ones), otherwise stable. */
export const sortActions = (as: Action[]) => [...as].sort((a, b) => Number(!!b.primary && !b.disabled) - Number(!!a.primary && !a.disabled));
