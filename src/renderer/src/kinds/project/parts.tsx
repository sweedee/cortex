/** Small building blocks shared by the project, ticket and deployment sidebars. */
import { useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { TextInput } from '@dynatrace/strato-components/forms';
import { camera } from '../../layout';
import { inspect, select } from '../../store';
import { TONE_CHIP } from '../../tones';
import type { Tone } from '../../domain';
import { errorText } from '../../ui/task';

/** Select a bubble, show it in the sidebar and bring it into view. */
export function focusItem(id: string) {
  inspect(id);
  select([id]);
  camera.focus([id]);
}

export function ToneChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Chip size="condensed" color={TONE_CHIP[tone]} variant={tone === 'neutral' || tone === 'pending' ? undefined : 'emphasized'}>
      {children}
    </Chip>
  );
}

export const mono = { font: '12px var(--dt-typography-code-base-default-family, ui-monospace), monospace' } as const;

/** A muted one-liner for hints, empty states and inline errors. */
export function Note({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <div style={{ fontSize: 12, color: tone === 'error' ? 'var(--tone-critical)' : 'var(--ink-subdued)', lineHeight: 1.45 }}>{children}</div>;
}

/** The state of a query as a short line (loading / error / not available), or null when there is data. */
export function QueryNote({ q, what, offlineHint }: { q: { isLoading: boolean; isError: boolean; error: unknown; fetchStatus: string; data: unknown }; what: string; offlineHint?: string }) {
  if (q.isLoading) return <Note>Loading {what}…</Note>;
  if (q.isError)
    return (
      <Note tone="error">
        Could not load {what}: {errorText(q.error)}
      </Note>
    );
  if (q.data === undefined && q.fetchStatus === 'idle') return <Note>{offlineHint ?? `${what} needs the Cortex server and a configured project.`}</Note>;
  return null;
}

/** A row with a label, a value and trailing buttons. */
export function ValueRow({ label, children, actions }: { label: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', minHeight: 28 }}>
      <span style={{ flex: 'none', width: 92, fontSize: 11, color: 'var(--ink-faint)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {actions && <span style={{ flex: 'none', display: 'flex', gap: 2 }}>{actions}</span>}
    </div>
  );
}

/** A small icon-only button. */
export function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button size="condensed" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Button.Prefix>{children}</Button.Prefix>
    </Button>
  );
}

/** A text value that is edited in place; commits on blur / Enter when it changed. */
export function InlineText({ value, placeholder, onCommit, label }: { value: string; placeholder?: string; onCommit: (v: string) => void; label: string }) {
  // (callers pass `key={value}` so an outside change resets the text)
  const [text, setText] = useState(value);
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim());
  };
  return (
    <div
      style={{ flex: 1, minWidth: 0 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        if (e.key === 'Escape') setText(value);
      }}
    >
      <TextInput value={text} placeholder={placeholder} aria-label={label} onChange={(v: string) => setText(v)} onBlur={commit} />
    </div>
  );
}
