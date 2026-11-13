import { EditIcon } from '@dynatrace/strato-icons';
import { placeholder } from '../common';
import { ChecklistIcon } from '../icons';
import type { KindModule } from '../types';

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.replace(/^[#\-*\s[\]x]+/i, '').trim() ?? '';

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
    const boxes = [...data.body.matchAll(/^\s*[-*] \[( |x)\]/gim)];
    return boxes.length ? [['Checklist', `${boxes.filter((b) => b[1].toLowerCase() === 'x').length} / ${boxes.length}`]] : [];
  },

  actions: () => [placeholder('edit', 'Edit…', <EditIcon />, { primary: true })],

  complete: () => ({ done: true }),

  addable: {
    label: 'Add todo…',
    hint: 'what needs doing? (markdown)',
    multiline: true,
    create: (v) => {
      const title = firstLine(v).slice(0, 60) || 'Todo';
      return { kind: 'todo', handle: `todo/${title.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 24).replace(/-$/, '')}`, title, data: { body: v, done: false } };
    },
  },
};
