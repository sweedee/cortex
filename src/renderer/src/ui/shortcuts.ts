/**
 * The keyboard shortcuts: one table that the canvas key handler matches against and the help
 * overlay (`?`) lists, so the two cannot drift apart. Pure.
 */

export type ShortcutScope = 'canvas' | 'bubble';

export type ShortcutId = 'chat' | 'fit' | 'remove' | 'selectAll' | 'primary' | 'escape' | 'help' | 'move' | 'open' | 'toggle';

/** One key: `key` is `KeyboardEvent.key` (letters lower case); `mod` = Ctrl, or ⌘ on macOS. */
export interface KeyBinding {
  key: string;
  mod?: boolean;
}

export interface Shortcut {
  id: ShortcutId;
  /** canvas: anywhere outside text fields and dialogs; bubble: while a bubble has keyboard focus */
  scope: ShortcutScope;
  keys: KeyBinding[];
  label: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'chat', scope: 'canvas', keys: [{ key: '/' }, { key: 'k', mod: true }], label: 'Write in the chat box' },
  { id: 'fit', scope: 'canvas', keys: [{ key: 'f' }], label: 'Zoom to the selection, or fit everything' },
  { id: 'selectAll', scope: 'canvas', keys: [{ key: 'a', mod: true }], label: 'Select every shown bubble' },
  { id: 'primary', scope: 'canvas', keys: [{ key: 'Enter' }], label: 'Run the main action of the selection' },
  { id: 'remove', scope: 'canvas', keys: [{ key: 'Delete' }, { key: 'Backspace' }], label: 'Remove the selection from the canvas' },
  { id: 'escape', scope: 'canvas', keys: [{ key: 'Escape' }], label: 'Close the details sidebar, then clear the selection' },
  { id: 'help', scope: 'canvas', keys: [{ key: '?' }], label: 'Show these shortcuts' },
  {
    id: 'move',
    scope: 'bubble',
    keys: [{ key: 'ArrowLeft' }, { key: 'ArrowUp' }, { key: 'ArrowRight' }, { key: 'ArrowDown' }],
    label: 'Move to the nearest bubble in that direction',
  },
  { id: 'open', scope: 'bubble', keys: [{ key: 'Enter' }], label: 'Select the bubble and open its details' },
  { id: 'toggle', scope: 'bubble', keys: [{ key: ' ' }], label: 'Add the bubble to the selection, or take it out' },
];

export const SCOPE_LABEL: Record<ShortcutScope, string> = {
  canvas: 'Canvas',
  bubble: 'Focused bubble (Tab into the canvas)',
};

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>;

const norm = (k: string) => (k.length === 1 ? k.toLowerCase() : k);

/** The shortcut a key press triggers in a scope, or null. Alt combinations never match. */
export function matchShortcut(e: KeyLike, scope: ShortcutScope): ShortcutId | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const key = norm(e.key);
  const hit = SHORTCUTS.find((s) => s.scope === scope && s.keys.some((b) => norm(b.key) === key && !!b.mod === mod));
  return hit?.id ?? null;
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Delete: 'Delete',
  Backspace: 'Backspace',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowRight: '→',
  ArrowDown: '↓',
};

/** How a key is written in the UI: "Ctrl+K" (⌘K on macOS), "Esc", "F", "←". */
export function keyLabel(b: KeyBinding, mac = false): string {
  const name = KEY_NAMES[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key);
  if (!b.mod) return name;
  return mac ? `⌘${name}` : `Ctrl+${name}`;
}

/** The shortcuts of one scope, in table order. */
export const shortcutsIn = (scope: ShortcutScope) => SHORTCUTS.filter((s) => s.scope === scope);

/** The written keys of a shortcut, e.g. "Ctrl+K" for chat (for tooltips). */
export const shortcutHint = (id: ShortcutId, mac = false) =>
  SHORTCUTS.find((s) => s.id === id)
    ?.keys.map((b) => keyLabel(b, mac))
    .join(' / ') ?? '';

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
