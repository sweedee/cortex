import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { ChevronDownIcon, PlusIcon } from '@dynatrace/strato-icons';
import { AutoFocus } from '../components/AutoFocus';
import { TodoItem } from '../components/TodoItem';
import type { Todo, WorkItem } from '../model/types';
import { selectWork } from '../state/actions';
import { relativeTime } from '../state/derive';
import { useCortex } from '../state/store';
import { addTodo, clearDoneTodos, moveTodo } from '../state/todos';
import '../shell/shell.css';

const labelOf = (w: WorkItem) => w.ticket?.key ?? (w.kind === 'review' ? `PR #${w.pr?.number}` : w.title);

/** Menu to attach a todo (or the capture box) to a work item. */
function WorkPicker({ work, value, onChange }: { work: WorkItem[]; value: string | undefined; onChange: (id: string | undefined) => void }) {
  const current = work.find((w) => w.id === value);
  return (
    <Menu>
      <Menu.Trigger>
        <Button size="condensed" aria-label="Attach to work">
          {current ? labelOf(current) : 'No work'}
          <Button.Suffix>
            <ChevronDownIcon />
          </Button.Suffix>
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item onSelect={() => onChange(undefined)}>No work</Menu.Item>
        {work.map((w) => (
          <Menu.Item key={w.id} onSelect={() => onChange(w.id)}>
            {w.ticket ? `${w.ticket.key} · ${w.title}` : w.title}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
}

function Group({ title, onOpen, todos, work }: { title: string; onOpen?: () => void; todos: Todo[]; work: WorkItem[] }) {
  if (todos.length === 0) return null;
  return (
    <section>
      <Flex alignItems="center" gap={8} paddingBottom={4}>
        <Text textStyle="small-emphasized" className="cx-tone-neutral">
          {title}
        </Text>
        {onOpen && (
          <Button size="condensed" onClick={onOpen}>
            Open
          </Button>
        )}
      </Flex>
      {todos.map((t) => (
        <TodoItem
          key={t.id}
          todo={t}
          trailing={
            <>
              <Text textStyle="small" className="cx-tone-neutral" style={{ flex: 'none' }}>
                {relativeTime(t.done && t.doneAt ? t.doneAt : t.createdAt)}
              </Text>
              {!t.done && <WorkPicker work={work} value={t.workId} onChange={(id) => moveTodo(t.id, id)} />}
            </>
          }
        />
      ))}
    </section>
  );
}

export function TodosView() {
  const todos = useCortex((s) => s.todos);
  const work = useCortex((s) => s.work);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<string | undefined>();

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const known = new Set(work.map((w) => w.id));
  // todos whose work was archived fall back to the general list
  const general = open.filter((t) => !t.workId || !known.has(t.workId));

  const submit = () => {
    addTodo(text, target);
    setText('');
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <Flex flexDirection="column" gap={24} padding={24} style={{ maxWidth: 820, margin: '0 auto' }}>
        <Flex alignItems="baseline" gap={12}>
          <Heading level={3} as="h1">
            Todos
          </Heading>
          <Text className="cx-tone-neutral">
            {open.length} open{done.length > 0 && ` · ${done.length} done`}
          </Text>
        </Flex>

        <Flex gap={8} alignItems="center">
          <AutoFocus style={{ flex: 1 }}>
            <TextInput
              aria-label="New todo"
              placeholder="Note to self… (Enter to add)"
              value={text}
              onChange={setText}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </AutoFocus>
          <WorkPicker work={work} value={target} onChange={setTarget} />
          <Button variant="accent" color="primary" disabled={!text.trim()} onClick={submit}>
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add
          </Button>
        </Flex>

        {open.length === 0 && <Text className="cx-tone-neutral">Nothing open. Enjoy it while it lasts.</Text>}

        <Group title="General" todos={general} work={work} />
        {work.map((w) => (
          <Group
            key={w.id}
            title={w.ticket ? `${w.ticket.key} · ${w.title}` : w.title}
            onOpen={() => selectWork(w.id)}
            todos={open.filter((t) => t.workId === w.id)}
            work={work}
          />
        ))}

        {done.length > 0 && (
          <section>
            <Flex alignItems="center" gap={8} paddingBottom={4}>
              <Text textStyle="small-emphasized" className="cx-tone-neutral">
                Done
              </Text>
              <Chip size="condensed">{done.length}</Chip>
              <Button size="condensed" onClick={clearDoneTodos}>
                Clear
              </Button>
            </Flex>
            {done.map((t) => (
              <TodoItem
                key={t.id}
                todo={t}
                trailing={
                  <Text textStyle="small" className="cx-tone-neutral" style={{ flex: 'none' }}>
                    {relativeTime(t.doneAt ?? t.createdAt)}
                  </Text>
                }
              />
            ))}
          </section>
        )}
      </Flex>
    </div>
  );
}
