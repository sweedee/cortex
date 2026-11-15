/**
 * Compact model / effort / permission-mode pickers for a composer. Used by the chat box (defaults
 * for new sessions, persisted in Settings) and the agent sidebar (that session, changed live
 * when the CLI can take it). Choices come from the CLI's catalog when known (`useClaudeCatalog`).
 */
import type { ReactNode } from 'react';
import { Menu } from '@dynatrace/strato-components/navigation';
import { AIModelIcon, CheckmarkIcon, ChevronDownIcon, IdeaIcon, SecurityIcon } from '@dynatrace/strato-icons';
import type { ClaudeEffort } from '../../../shared/integrations/claude';
import { useClaudeCatalog } from '../data/claude';
import { effortChoices, modelChoiceOf, modelChoices, PERMISSION_CHOICES, permissionChoice, type Choice, type PermissionValue } from './sessionOptions';
import './sessionPickers.css';

function Picker({ title, icon, value, choices, onChange, disabled, tone, pending }: { title: string; icon: ReactNode; value: string; choices: Choice[]; onChange: (v: string) => void; disabled?: boolean; tone?: string; pending?: boolean }) {
  const cur = choices.find((c) => c.value === value) ?? choices[0] ?? { value: '', label: '', short: '' };
  return (
    <Menu>
      <Menu.Trigger>
        <button type="button" className={`sp-btn ${tone ? `tone-${tone}` : ''} ${value ? 'is-set' : ''}`} disabled={disabled} title={`${title}: ${cur.label}${pending ? ' (applies with the next message)' : ''}`} aria-label={`${title}: ${cur.label}`}>
          {icon}
          <span className="sp-val">{cur.short}</span>
          {pending && <span className="sp-pending" aria-hidden />}
          <ChevronDownIcon className="sp-caret" />
        </button>
      </Menu.Trigger>
      <Menu.Content side="top" alignment="start">
        <Menu.Group>
          <Menu.Label>{title}</Menu.Label>
          {choices.map((c) => (
            <Menu.Item key={c.value || 'default'} textValue={c.label} onSelect={() => c.value !== value && onChange(c.value)}>
              <Menu.Prefix>{c.value === value ? <CheckmarkIcon /> : <span className="sp-blank" />}</Menu.Prefix>
              <span className="sp-item">
                <span>{c.label}</span>
                {c.hint && <span className="sp-hint">{c.hint}</span>}
              </span>
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

export interface SessionChoice {
  /** alias / id; '' or undefined = CLI default */
  model?: string;
  effort?: ClaudeEffort;
  permissionMode?: string;
}

/** The three pickers in a row. `onChange` gets only the changed field (`''` = back to the default). */
export function SessionPickers({ value, onChange, disabled, pending, label }: { value: SessionChoice; onChange: (patch: { model?: string; effort?: ClaudeEffort | ''; permissionMode?: PermissionValue }) => void; disabled?: boolean; pending?: string[]; label?: string }) {
  const catalog = useClaudeCatalog().data;
  const model = modelChoiceOf(catalog, value.model);
  const mode = permissionChoice(value.permissionMode);
  return (
    <span className="sp-row" role="group" aria-label={label ?? 'Session settings'}>
      <Picker title="Model" icon={<AIModelIcon />} value={model} choices={modelChoices(catalog, model)} disabled={disabled} pending={pending?.includes('model')} onChange={(v) => onChange({ model: v })} />
      <Picker title="Effort" icon={<IdeaIcon />} value={value.effort ?? ''} choices={effortChoices(catalog, value.model)} disabled={disabled} pending={pending?.includes('effort')} onChange={(v) => onChange({ effort: v as ClaudeEffort | '' })} />
      <Picker
        title="Permission mode"
        icon={<SecurityIcon />}
        value={mode.value === 'default' ? '' : mode.value}
        choices={PERMISSION_CHOICES.map((c) => ({ ...c, value: c.value === 'default' ? '' : c.value }))}
        tone={mode.tone}
        disabled={disabled}
        pending={pending?.includes('permission mode')}
        onChange={(v) => onChange({ permissionMode: (v || 'default') as PermissionValue })}
      />
    </span>
  );
}
