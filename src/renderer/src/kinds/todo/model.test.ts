import { describe, expect, it } from 'vitest';
import { checklist, firstLine, handleOf, todoFromForm } from './model';

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
