/** Pure helpers of the todo kind. */
import type { ItemOf, NewItem } from '../../domain';
import { findTaskLines, toggleTask } from '../../components/viewers/markdown/markdownUtils';

export const firstLine = (s: string) =>
  s
    .split('\n')
    .find((l) => l.trim())
    ?.replace(/^[#\-*\s[\]x]+/i, '')
    .trim() ?? '';

export const handleOf = (title: string) => `todo/${title.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 24).replace(/^-+|-+$/g, '')}`;

/** A todo from the quick-add form: title, optional body, optional project. */
export function todoFromForm(title: string, body: string, project: ItemOf<'project'> | undefined, handleTaken: (h: string) => boolean = () => false): NewItem {
  const t = title.trim().slice(0, 120) || 'Todo';
  let handle = handleOf(t);
  for (let n = 2; handleTaken(handle); n++) handle = `${handleOf(t)}-${n}`;
  return { kind: 'todo', handle, title: t, projectId: project?.id, data: { body: body.trim() ? body : '', done: false } };
}

/** Checked / total markdown checkboxes of a body. */
export function checklist(body: string): { done: number; total: number } {
  const items = checklistItems(body);
  return { done: items.filter((i) => i.checked).length, total: items.length };
}

// ---- checklist items (quick actions) -------------------------------------------------------

export interface ChecklistItem {
  /** index among the task items of the body, as `toggleTask` / the markdown preview count them */
  index: number;
  text: string;
  checked: boolean;
}

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/;

/** The task items of a body, in document order (code fences skipped, like the preview does). */
export function checklistItems(body: string): ChecklistItem[] {
  const lines = body.split('\n');
  return findTaskLines(body).map((lineNo, index) => {
    const m = TASK_LINE.exec(lines[lineNo]);
    return { index, text: (m?.[2] ?? '').trim(), checked: m?.[1].toLowerCase() === 'x' };
  });
}

/** The body with the `index`-th task item flipped (unchanged when out of range). */
export function toggleChecklistItem(body: string, index: number): string {
  const item = checklistItems(body)[index];
  return item ? toggleTask(body, index, !item.checked) : body;
}

/** Shorten a task text for a menu label. */
export function shortLabel(text: string, max = 36): string {
  const t = text.replace(/\s+/g, ' ').trim() || '(empty)';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The checklist items to offer as quick actions: only for several items, at most `max`. When there
 * are more, open items win over checked ones; document order is kept.
 */
export function quickChecklist(body: string, max = 8): ChecklistItem[] {
  const all = checklistItems(body);
  if (all.length < 2) return [];
  if (all.length <= max) return all;
  const keep = new Set([...all.filter((i) => !i.checked), ...all.filter((i) => i.checked)].slice(0, max).map((i) => i.index));
  return all.filter((i) => keep.has(i.index));
}
