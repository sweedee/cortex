import { useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Checkbox, TextInput } from '@dynatrace/strato-components/forms';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import { DeleteIcon } from '@dynatrace/strato-icons';
import Colors from '@dynatrace/strato-design-tokens/colors';
import type { Todo } from '../model/types';
import { AutoFocus } from './AutoFocus';
import { deleteTodo, editTodo, toggleTodo } from '../state/todos';

/**
 * One todo line: checkbox · text (double-click to edit) · trailing slot · delete.
 * `compact` is the variant used on work cards.
 */
export function TodoItem({ todo, trailing, compact }: { todo: Todo; trailing?: ReactNode; compact?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null) editTodo(todo.id, draft);
    setDraft(null);
  };

  return (
    <div
      className="cx-todo"
      data-compact={compact || undefined}
      // todos live inside clickable cards — never let a click fall through
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Checkbox name={todo.id} aria-label={todo.done ? 'Mark as open' : 'Mark as done'} value={todo.done} onChange={() => toggleTodo(todo.id)} />
      {draft !== null ? (
        <AutoFocus style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            aria-label="Edit todo"
            value={draft}
            onChange={setDraft}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
        </AutoFocus>
      ) : (
        <Text
          textStyle={compact ? 'small' : 'base'}
          className={compact ? 'cx-ellipsis' : undefined}
          title={compact ? todo.text : 'Double-click to edit'}
          onDoubleClick={() => setDraft(todo.text)}
          style={{
            flex: 1,
            minWidth: 0,
            color: todo.done ? Colors.Text.Neutral.Subdued : undefined,
            textDecoration: todo.done ? 'line-through' : undefined,
          }}
        >
          {todo.text}
        </Text>
      )}
      {trailing}
      {!compact && (
        <Tooltip text="Delete">
          <Button size="condensed" aria-label="Delete todo" className="cx-todo-delete" onClick={() => deleteTodo(todo.id)}>
            <Button.Prefix>
              <DeleteIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
