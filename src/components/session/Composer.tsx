import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Text } from '@dynatrace/strato-components/typography';
import { ArrowUpIcon, CheckmarkIcon, ChevronDownIcon, StopIcon } from '@dynatrace/strato-icons';
import type { Skill } from '../../model/types';
import { CLAUDE_DEFAULTS, CLAUDE_MODELS, EFFORT_LEVELS, modelInfo } from '../../services/config';
import { useCortex } from '../../state/store';
import { subduedText } from './meta';

const MAX_RESULTS = 50;

/** The "/token" the caret is in, if it starts the message or follows whitespace and has no further "/". */
function slashToken(text: string, caret: number) {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const token = text.slice(start, caret);
  if (!token.startsWith('/') || token.indexOf('/', 1) !== -1) return null;
  return { start, end: caret, query: token.slice(1) };
}

function matchSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  if (!q) return skills.slice(0, MAX_RESULTS);
  const rank = (sk: Skill) => {
    const i = sk.name.toLowerCase().indexOf(q);
    if (i === 0) return 0;
    if (i > 0) return 1;
    return sk.description.toLowerCase().includes(q) ? 2 : -1;
  };
  return skills
    .map((sk) => ({ sk, r: rank(sk) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.sk)
    .slice(0, MAX_RESULTS);
}

function Highlighted({ name, query }: { name: string; query: string }) {
  const i = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, i)}
      <mark>{name.slice(i, i + query.length)}</mark>
      {name.slice(i + query.length)}
    </>
  );
}

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
  /** skills offered by the "/" autocomplete; defaults to the ones in the store */
  skills?: Skill[];
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

export function Composer({ onSend, onStop, running, placeholder = 'Message Claude…', rows = 1, autoFocus, hint, skills, options }: Props) {
  const storeSkills = useCortex((s) => s.skills);
  const all = skills ?? storeSkills;
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [below, setBelow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${uid}-skills`;

  const token = all.length ? slashToken(text, caret) : null;
  const tokenKey = token ? `${token.start}:${text.slice(token.start, token.end)}` : null;
  const matches = useMemo(() => (token ? matchSkills(all, token.query) : []), [all, token?.query]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = !!token && matches.length > 0 && dismissed !== tokenKey;
  const activeIdx = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (i: number) => `${uid}-opt-${i}`;

  // not enough room above the composer (e.g. the chat on an empty page) → open the popup below it
  useLayoutEffect(() => {
    if (open && rootRef.current) setBelow(rootRef.current.getBoundingClientRect().top < 280);
  }, [open]);
  useEffect(() => setActive(0), [token?.query]);
  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const accept = (skill: Skill) => {
    if (!token) return;
    const insert = `/${skill.name} `;
    const next = text.slice(0, token.start) + insert + text.slice(token.end);
    const pos = token.start + insert.length;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? 0);

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
    setCaret(0);
  };

  return (
    <div className="cx-composer" ref={rootRef}>
      {open && (
        <div className={`cx-skill-popup${below ? ' below' : ''}`} id={listId} role="listbox" aria-label="Skills" ref={listRef}>
          {matches.map((sk, i) => (
            <div
              key={`${sk.source}:${sk.name}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIdx}
              className="cx-skill-row"
              onMouseDown={(e) => {
                e.preventDefault();
                accept(sk);
              }}
              onMouseMove={() => i !== activeIdx && setActive(i)}
            >
              <span className="cx-skill-name">
                /<Highlighted name={sk.name} query={token?.query ?? ''} />
              </span>
              <span className="cx-skill-desc">{sk.description}</span>
              <span className="cx-skill-tag">{sk.source}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={rows}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIdx) : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') syncCaret();
        }}
        onClick={syncCaret}
        onSelect={syncCaret}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setActive((activeIdx + d + matches.length) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              accept(matches[activeIdx]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setDismissed(tokenKey);
              return;
            }
          }
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
            {hint ?? `Enter to send · Shift+Enter for a new line${all.length ? ' · / for skills' : ''}`}
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
