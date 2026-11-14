import { describe, expect, it } from 'vitest';
import { checklist, checklistItems, firstLine, handleOf, quickChecklist, shortLabel, toggleChecklistItem, todoFromForm } from './model';

const BODY = '# Release\n- [x] build it\n- [ ] ship it\n\n```\n- [ ] not a task\n```\n1. [ ]   test   it  \n* [X] done too';

describe('todo checklist items', () => {
  it('lists task items in document order, skipping code fences', () => {
    expect(checklistItems(BODY)).toEqual([
      { index: 0, text: 'build it', checked: true },
      { index: 1, text: 'ship it', checked: false },
      { index: 2, text: 'test   it', checked: false },
      { index: 3, text: 'done too', checked: true },
    ]);
    expect(checklist(BODY)).toEqual({ done: 2, total: 4 });
    expect(checklistItems('no tasks here')).toEqual([]);
  });

  it('toggles exactly one item both ways and ignores a bad index', () => {
    const on = toggleChecklistItem(BODY, 1);
    expect(on.split('\n')[2]).toBe('- [x] ship it');
    expect(toggleChecklistItem(on, 1)).toBe(BODY);
    expect(toggleChecklistItem(BODY, 0).split('\n')[1]).toBe('- [ ] build it');
    expect(toggleChecklistItem(BODY, 3)).toBe(BODY.replace('* [X]', '* [ ]'));
    expect(toggleChecklistItem(BODY, 9)).toBe(BODY);
  });

  it('shortens long labels', () => {
    expect(shortLabel('a  b\n c')).toBe('a b c');
    expect(shortLabel('x'.repeat(50))).toHaveLength(36);
    expect(shortLabel('x'.repeat(50)).endsWith('…')).toBe(true);
    expect(shortLabel('  ')).toBe('(empty)');
  });

  it('offers quick actions only for several items, capped, open items first', () => {
    expect(quickChecklist('- [ ] only one')).toEqual([]);
    expect(quickChecklist(BODY)).toHaveLength(4);
    const many = Array.from({ length: 12 }, (_, i) => `- [${i < 3 ? 'x' : ' '}] item ${i}`).join('\n');
    const q = quickChecklist(many, 8);
    expect(q).toHaveLength(8);
    expect(q.every((i) => !i.checked)).toBe(true);
    expect(q.map((i) => i.index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('todo model', () => {
  it('derives first line, handle and checklist', () => {
    expect(firstLine('\n# Release notes\nmore')).toBe('Release notes');
    expect(handleOf('Ask Mara: about OTLP!')).toBe('todo/ask-mara-about-otlp');
    expect(checklist('- [x] a\n- [ ] b\n* [X] c\ntext')).toEqual({ done: 2, total: 3 });
  });
  it('builds a todo from the quick-add form', () => {
    const t = todoFromForm('  Call Mara ', '', undefined, (h) => h === 'todo/call-mara');
    expect(t).toMatchObject({ kind: 'todo', title: 'Call Mara', handle: 'todo/call-mara-2', data: { body: '', done: false } });
    expect(todoFromForm('', 'x', undefined).title).toBe('Todo');
  });
});
