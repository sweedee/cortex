/**
 * User-created todos (notes to self). Unlike everything else in the prototype
 * these are real: they are persisted in localStorage and survive a reload.
 */
import type { Todo } from '../model/types';
import { persistSlice } from './persist';
import { setState } from './store';

const STORAGE_KEY = 'cortex.todos.v1';

const SEED: Todo[] = [
  { id: 'todo-seed-1', text: 'Ask Jonas about the outbound proxy idle timeout', done: false, workId: 'CTX-1423', createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
  { id: 'todo-seed-2', text: 'Double-check the dead-letter metric name with Priya', done: false, workId: 'CTX-1423', createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() },
  { id: 'todo-seed-3', text: 'Book a room for the sprint review', done: false, createdAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
  { id: 'todo-seed-4', text: 'Renew the VPN certificate', done: true, createdAt: new Date(Date.now() - 50 * 3600_000).toISOString(), doneAt: new Date(Date.now() - 20 * 3600_000).toISOString() },
];

/** Loads persisted todos into the store and keeps storage in sync from then on. */
export const initTodos = () => persistSlice('todos', STORAGE_KEY, SEED);

const patchTodos = (fn: (todos: Todo[]) => Todo[]) => setState((s) => ({ ...s, todos: fn(s.todos) }));

export function addTodo(text: string, workId?: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const todo: Todo = {
    id: `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: trimmed,
    done: false,
    workId,
    createdAt: new Date().toISOString(),
  };
  patchTodos((todos) => [todo, ...todos]);
}

export const toggleTodo = (id: string) =>
  patchTodos((todos) =>
    todos.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? undefined : new Date().toISOString() } : t)),
  );

export const editTodo = (id: string, text: string) =>
  patchTodos((todos) => todos.map((t) => (t.id === id && text.trim() ? { ...t, text: text.trim() } : t)));

/** Attach a todo to a work item, or detach it with `undefined`. */
export const moveTodo = (id: string, workId: string | undefined) =>
  patchTodos((todos) => todos.map((t) => (t.id === id ? { ...t, workId } : t)));

export const deleteTodo = (id: string) => patchTodos((todos) => todos.filter((t) => t.id !== id));

export const clearDoneTodos = () => patchTodos((todos) => todos.filter((t) => !t.done));

/** Opens the global todo list in the main view. */
export const openTodos = () => setState((s) => ({ ...s, view: { workId: null, tab: 'ticket', page: 'todos' } }));
