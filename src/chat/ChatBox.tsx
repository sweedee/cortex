/**
 * The single chat box at the bottom centre. A textarea with a mirrored highlight layer
 * behind it, so @mentions and /skills render as tokens while editing stays plain text.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { KeyboardShortcut } from '@dynatrace/strato-components/content';
import { AiIcon, ArrowUpIcon, XmarkIcon } from '@dynatrace/strato-icons';
import { actionsForSelection, sendPrompt } from '../actions';
import { KIND_LABEL, type Item } from '../model';
import { mentionedIds, select, setDraft, useStore } from '../store';
import { KIND_ACCENT, KIND_ICON } from '../visual';
import { ActionButton } from '../canvas/Overlays';
import { camera } from '../layout';

export const SKILLS: { name: string; desc: string }[] = [
  { name: 'plan-ticket', desc: 'Explore the code and write a plan file' },
  { name: 'implement', desc: 'Implement a ticket or plan in its worktree' },
  { name: 'implement-plan', desc: 'Work through an approved plan step by step' },
  { name: 'self-review', desc: 'Critical review of the branch before a PR' },
  { name: 'create-pr', desc: 'Push and open a pull request' },
  { name: 'review-pr', desc: 'Review someone else’s pull request' },
  { name: 'address-review', desc: 'Fix unresolved review comments' },
  { name: 'resolve-conflicts', desc: 'Rebase and resolve merge conflicts' },
  { name: 'fix-ci', desc: 'Find why a build failed and fix it' },
  { name: 'explain-build', desc: 'Explain a CI failure without changing code' },
  { name: 'grill-plan', desc: 'Poke holes in a plan before approving it' },
  { name: 'refine-ticket', desc: 'Sharpen description and acceptance criteria' },
  { name: 'triage-tickets', desc: 'Sort and size the incoming tickets' },
  { name: 'review-renovate', desc: 'Review and merge safe dependency updates' },
  { name: 'plan-feature', desc: 'Break a feature down into tickets' },
  { name: 'describe-pr', desc: 'Write the PR description from the diff' },
  { name: 'status-summary', desc: 'Summarise where these items stand' },
  { name: 'continue-session', desc: 'Send a follow-up to an agent session' },
  { name: 'fork-session', desc: 'Branch a session to try another approach' },
];

type Popup =
  | { type: 'mention'; start: number; query: string; options: Item[] }
  | { type: 'skill'; start: number; query: string; options: typeof SKILLS }
  | null;

const TOKEN = /(@[^\s@]+|(?:^|(?<=\s))\/[\w-]+)/g;

export function ChatBox() {
  const draft = useStore((s) => s.draft);
  const items = useStore((s) => s.items);
  const selected = useStore((s) => s.selected);
  const focusTick = useStore((s) => s.focusTick);
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<Popup>(null);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState(0);

  const handles = useMemo(() => new Map(items.map((i) => [i.handle.toLowerCase(), i])), [items]);
  const mentioned = useMemo(() => mentionedIds(draft, items).map((id) => items.find((i) => i.id === id)!), [draft, items]);
  const sel = actionsForSelection(selected);

  // focus requests (actions inserting a skill, "/" shortcut): caret to the end
  useEffect(() => {
    if (!focusTick || !ta.current) return;
    const el = ta.current;
    el.focus();
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  }, [focusTick]);

  // auto-grow
  useLayoutEffect(() => {
    const el = ta.current!;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [draft]);

  const refreshPopup = (text: string, pos: number) => {
    setCaret(pos);
    const before = text.slice(0, pos);
    const m = before.match(/(^|\s)@([^\s@]*)$/);
    if (m) {
      const q = m[2].toLowerCase();
      const options = items
        .filter((i) => i.handle.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
        .sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || Number(b.handle.toLowerCase().startsWith(q)) - Number(a.handle.toLowerCase().startsWith(q)))
        .slice(0, 7);
      setPopup({ type: 'mention', start: pos - m[2].length - 1, query: m[2], options });
      setActive(0);
      return;
    }
    const s = before.match(/(^|\s)\/([\w-]*)$/);
    if (s) {
      const q = s[2].toLowerCase();
      const options = SKILLS.filter((k) => k.name.includes(q)).slice(0, 7);
      setPopup({ type: 'skill', start: pos - s[2].length - 1, query: s[2], options });
      setActive(0);
      return;
    }
    setPopup(null);
  };

  const accept = (i: number) => {
    if (!popup || !popup.options[i]) return;
    const insert = popup.type === 'mention' ? `@${(popup.options[i] as Item).handle} ` : `/${(popup.options[i] as (typeof SKILLS)[number]).name} `;
    const end = popup.start + 1 + popup.query.length;
    const next = draft.slice(0, popup.start) + insert + draft.slice(end);
    setDraft(next);
    setPopup(null);
    const pos = popup.start + insert.length;
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendPrompt(text, mentionedIds(text, items));
    setDraft('');
    setPopup(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popup && popup.options.length) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setActive((a) => (a + 1) % popup.options.length));
      if (e.key === 'ArrowUp') return (e.preventDefault(), setActive((a) => (a - 1 + popup.options.length) % popup.options.length));
      if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), accept(active));
    }
    if (e.key === 'Escape') {
      if (popup) setPopup(null);
      else ta.current?.blur();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // highlight layer: same text, tokens wrapped
  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    let last = 0;
    for (const m of draft.matchAll(TOKEN)) {
      const t = m[0];
      const i = m.index!;
      out.push(draft.slice(last, i));
      if (t.startsWith('@')) {
        const it = handles.get(t.slice(1).toLowerCase());
        out.push(
          <mark key={i} className={`tok tok-mention ${it ? '' : 'is-unknown'}`} style={it ? { ['--accent' as string]: KIND_ACCENT[it.kind] } : undefined}>
            {t}
          </mark>,
        );
      } else {
        const known = SKILLS.some((s) => s.name === t.slice(1));
        out.push(
          <mark key={i} className={`tok tok-skill ${known ? '' : 'is-unknown'}`}>
            {t}
          </mark>,
        );
      }
      last = i + t.length;
    }
    out.push(draft.slice(last) + '​');
    return out;
  }, [draft, handles]);

  const syncScroll = () => {
    if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop;
  };

  const placeholder = selected.length
    ? 'Ask about the selection, or pick an action above…'
    : 'Ask Cortex anything — @ to mention a bubble, / for a skill';

  return (
    <div className="chat-dock">
      {sel.items.length > 0 && (
        <div className="chat-actions" key={selected.join(',')}>
          <span className="chat-actions-for">
            {sel.items.length === 1 ? (
              <>
                {KIND_ICON[sel.items[0].kind](14)}
                <span>{sel.items[0].handle}</span>
              </>
            ) : (
              <span>{sel.items.length} selected</span>
            )}
          </span>
          {sel.actions.map((a) => (
            <ActionButton key={a.id} action={a} items={sel.items} />
          ))}
          <button className="chat-actions-clear" onClick={() => select([])} aria-label="Clear selection">
            <XmarkIcon />
          </button>
        </div>
      )}

      <div className={`chatbox ${popup ? 'has-popup' : ''}`}>
        {mentioned.length > 0 && (
          <div className="chat-context">
            <span className="chat-context-label">Context</span>
            {mentioned.map((m) => (
              <button key={m.id} className="ctx-chip" style={{ ['--accent' as string]: KIND_ACCENT[m.kind] }} onClick={() => camera.focus([m.id])} title={`${KIND_LABEL[m.kind]} · ${m.title}`}>
                {KIND_ICON[m.kind](12)}
                <span>{m.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="chat-row">
          <span className="chat-spark">
            <AiIcon />
          </span>
          <div className="chat-input">
            <div ref={mirror} className="chat-mirror" aria-hidden>
              {parts.map((p, i) => (
                <Fragment key={i}>{p}</Fragment>
              ))}
            </div>
            <textarea
              ref={ta}
              rows={1}
              value={draft}
              placeholder={placeholder}
              spellCheck={false}
              onChange={(e) => {
                setDraft(e.target.value);
                refreshPopup(e.target.value, e.target.selectionStart);
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshPopup(draft, e.currentTarget.selectionStart);
              }}
              onClick={(e) => refreshPopup(draft, e.currentTarget.selectionStart)}
              onBlur={() => setTimeout(() => setPopup(null), 120)}
              onScroll={syncScroll}
              aria-label="Chat with Cortex"
            />
          </div>
          <div className="chat-send">
            {!draft && (
              <span className="chat-hint">
                <KeyboardShortcut keys="/" />
              </span>
            )}
            <Button variant="accent" color="primary" size="condensed" disabled={!draft.trim()} onClick={send} aria-label="Send">
              <Button.Prefix>
                <ArrowUpIcon />
              </Button.Prefix>
            </Button>
          </div>
        </div>

        {popup && popup.options.length > 0 && (
          <div className="chat-popup" role="listbox" style={{ left: Math.min(popupX(draft, caret), 380) }}>
            <div className="chat-popup-head">{popup.type === 'mention' ? 'Mention a bubble' : 'Insert a skill'}</div>
            {popup.type === 'mention'
              ? (popup.options as Item[]).map((o, i) => (
                  <div
                    key={o.id}
                    role="option"
                    aria-selected={i === active}
                    className={`chat-option ${i === active ? 'is-active' : ''}`}
                    onMouseDown={(e) => (e.preventDefault(), accept(i))}
                    onMouseEnter={() => setActive(i)}
                    style={{ ['--accent' as string]: KIND_ACCENT[o.kind] }}
                  >
                    <span className="chat-option-icon">{KIND_ICON[o.kind](14)}</span>
                    <span className="chat-option-main">@{o.handle}</span>
                    <span className="chat-option-sub">{o.title}</span>
                  </div>
                ))
              : (popup.options as typeof SKILLS).map((o, i) => (
                  <div
                    key={o.name}
                    role="option"
                    aria-selected={i === active}
                    className={`chat-option ${i === active ? 'is-active' : ''}`}
                    onMouseDown={(e) => (e.preventDefault(), accept(i))}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="chat-option-icon">
                      <AiIcon />
                    </span>
                    <span className="chat-option-main">/{o.name}</span>
                    <span className="chat-option-sub">{o.desc}</span>
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Rough x of the caret on the last line, so the popup opens near what you type. */
function popupX(text: string, caret: number) {
  const line = text.slice(0, caret).split('\n').pop() ?? '';
  return Math.max(0, line.length * 7.6 - 40);
}
