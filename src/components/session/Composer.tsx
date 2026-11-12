import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Text } from '@dynatrace/strato-components/typography';
import { ArrowUpIcon, CheckmarkIcon, ChevronDownIcon, StopIcon } from '@dynatrace/strato-icons';
import { CLAUDE_DEFAULTS, CLAUDE_MODELS, EFFORT_LEVELS, modelInfo } from '../../services/config';
import { subduedText } from './meta';

/** Model + effort of the session the composer belongs to. Both are fixed while the session runs. */
export interface ComposerOptions {
  model: string;
  effort?: string;
  disabled?: boolean;
  onChange: (patch: { model?: string; effort?: string }) => void;
}

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  running?: boolean;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  hint?: ReactNode;
  options?: ComposerOptions;
}

/** A tiny dropdown: subdued text + chevron, no border until hovered. */
function Picker({ label, value, items, disabled, onPick }: { label: string; value: string; items: { id: string; text: string }[]; disabled?: boolean; onPick: (id: string) => void }) {
  const current = items.find((i) => i.id === value);
  return (
    <Menu>
      <Menu.Trigger>
        <button type="button" className="cx-btn cx-picker" disabled={disabled} aria-label={`${label}: ${current?.text ?? value}`} title={disabled ? `${label} can be changed between turns` : label}>
          {current?.text ?? value}
          <ChevronDownIcon />
        </button>
      </Menu.Trigger>
      <Menu.Content>
        {items.map((i) => (
          <Menu.Item key={i.id} onSelect={() => onPick(i.id)}>
            <Menu.Prefix>{i.id === value ? <CheckmarkIcon /> : <span style={{ display: 'inline-block', width: 16 }} />}</Menu.Prefix>
            {i.text}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
}

const MODEL_ITEMS = CLAUDE_MODELS.map((m) => ({ id: m.id, text: m.label }));
const EFFORT_ITEMS = EFFORT_LEVELS.map((e) => ({ id: e, text: e }));

export function Composer({ onSend, onStop, running, placeholder = 'Message Claude…', rows = 1, autoFocus, hint, options }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="cx-composer">
      <textarea
        ref={ref}
        rows={rows}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px 8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          {options && (
            <>
              <Picker
                label="Model"
                value={modelInfo(options.model).id}
                items={MODEL_ITEMS.some((m) => m.id === options.model) ? MODEL_ITEMS : [{ id: options.model, text: modelInfo(options.model).label }, ...MODEL_ITEMS]}
                disabled={options.disabled}
                onPick={(model) => options.onChange({ model })}
              />
              <Picker
                label="Reasoning effort"
                value={options.effort ?? CLAUDE_DEFAULTS.effort}
                items={EFFORT_ITEMS}
                disabled={options.disabled}
                onPick={(effort) => options.onChange({ effort })}
              />
              <span style={{ width: 8 }} />
            </>
          )}
          <Text textStyle="small" className="cx-ellipsis cx-composer-hint" style={subduedText}>
            {hint ?? (options ? 'Enter to send' : 'Enter to send · Shift+Enter for a new line')}
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: 'none', marginLeft: 'auto' }}>
          {running && onStop && (
            <Button variant="default" size="condensed" onClick={onStop}>
              <Button.Prefix>
                <StopIcon />
              </Button.Prefix>
              Stop
            </Button>
          )}
          <Button variant="accent" color="primary" size="condensed" disabled={!text.trim()} onClick={send} aria-label="Send">
            <Button.Prefix>
              <ArrowUpIcon />
            </Button.Prefix>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
