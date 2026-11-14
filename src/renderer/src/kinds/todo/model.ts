/** Pure helpers of the todo kind. */
import type { ItemOf, NewItem } from '../../domain';

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
  const boxes = [...body.matchAll(/^\s*[-*] \[( |x)\]/gim)];
  return { done: boxes.filter((b) => b[1].toLowerCase() === 'x').length, total: boxes.length };
}
