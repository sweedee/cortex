import { CheckmarkIcon, EditIcon, SquareIcon } from '@dynatrace/strato-icons';
import type { ItemOf } from '../../domain';
import { place } from '../../layout';
import { addItem, getState, inspect, itemById, makeItem, patchData, select } from '../../store';
import { openForm, str } from '../../ui/form';
import { oneLine } from '../common';
import { ChecklistIcon } from '../icons';
import type { KindModule } from '../types';
import { checklist, firstLine, handleOf, quickChecklist, shortLabel, toggleChecklistItem, todoFromForm } from './model';
import { TodoSidebar } from './Sidebar';

/** Quick add: a title (and optional notes) in a small form, placed where the user clicked. */
async function quickAdd(at: { x: number; y: number }) {
  const { items, selected } = getState();
  const projects = items.filter((i): i is ItemOf<'project'> => i.kind === 'project' && !i.archived);
  // default project: the one of the selection, else the only / first one
  const sel = selected.map((id) => items.find((i) => i.id === id)).find(Boolean);
  const preset = sel?.kind === 'project' ? sel.id : (sel?.projectId ?? projects[0]?.id ?? '');
  await openForm({
    title: 'Add todo',
    submitLabel: 'Add',
    values: { project: preset },
    fields: [
      { name: 'title', label: 'What needs doing?', type: 'text', required: true, placeholder: 'e.g. Ask Mara about quota' },
      { name: 'body', label: 'Notes', type: 'textarea', rows: 4, placeholder: 'Optional. Markdown, - [ ] for a checklist' },
      ...(projects.length ? [{ name: 'project', label: 'Project', type: 'select' as const, options: [{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: p.title }))] }] : []),
    ],
    onSubmit: (v) => {
      const project = projects.find((p) => p.id === str(v, 'project'));
      const handles = new Set(getState().items.map((i) => i.handle.toLowerCase()));
      const item = makeItem(todoFromForm(str(v, 'title'), str(v, 'body'), project, (h) => handles.has(h.toLowerCase())));
      place.seed(item.id, at);
      addItem(item, project ? [{ from: item.id, to: project.id, label: 'for' }] : []);
      select([item.id]);
      inspect(item.id);
    },
  });
}

/** A free-form note / to-do, markdown body. */
export const todo: KindModule<'todo'> = {
  kind: 'todo',
  label: 'Todo',
  icon: (s) => <ChecklistIcon size={s} />,
  radius: 24,
  level: 3,

  ring: ({ data }) => (data.done ? [{ tone: 'success', label: 'Done' }] : [{ tone: 'neutral', label: 'Open' }]),
  subtitle: ({ data, title }) => {
    const l = firstLine(data.body);
    return l && l !== title ? l : undefined;
  },
  facts: ({ data }) => {
    const c = checklist(data.body);
    return c.total ? [['Checklist', `${c.done} / ${c.total}`]] : [];
  },

  describe: (t) => `todo: ${oneLine(t.data.body || t.title)}`,

  actions: ([x]) => [
    {
      id: 'edit',
      label: 'Edit',
      type: 'view',
      icon: <EditIcon />,
      primary: true,
      run: ([x]) => {
        inspect(x.id);
        select([x.id]);
      },
    },
    // one action per checklist item (several items only): flips its box in the body
    ...(x ? quickChecklist(x.data.body) : []).map((c) => ({
      id: `check-${c.index}`,
      label: shortLabel(c.text), // the icon shows the state (box / tick)
      type: 'direct' as const,
      icon: c.checked ? <CheckmarkIcon /> : <SquareIcon />,
      run: ([t]: { id: string }[]) => {
        const cur = itemById(t.id);
        if (cur?.kind === 'todo') patchData<'todo'>(t.id, { body: toggleChecklistItem(cur.data.body, c.index) });
      },
    })),
  ],

  complete: () => ({ done: true }),

  Sidebar: TodoSidebar,

  addable: {
    label: 'Add todo…',
    hint: 'what needs doing? (markdown)',
    multiline: true,
    open: (at) => void quickAdd(at),
    create: (v) => {
      const title = firstLine(v).slice(0, 60) || 'Todo';
      return { kind: 'todo', handle: handleOf(title), title, data: { body: v, done: false } };
    },
  },
};
