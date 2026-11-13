/**
 * The single chat box at the bottom centre. A textarea with a mirrored highlight layer
 * behind it, so @mentions and /skills render as tokens while editing stays plain text.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { KeyboardShortcut } from '@dynatrace/strato-components/content';
import { AiIcon, ArrowUpIcon, XmarkIcon } from '@dynatrace/strato-icons';
import { actionsForItem, actionsForSelection, sendPrompt, type Action } from '../actions';
import type { Item } from '../domain';
import { skillIcon } from '../kinds/icons';
import { kindIcon, kindLabel } from '../kinds/registry';
import { mentionedIds, select, setDraft, setSearch, useStore, useVisible } from '../store';
import { accentOf, NEUTRAL_ACCENT, stripes, useItemColors } from '../visual';
import { ActionButton } from '../canvas/Overlays';
import { camera } from '../layout';

export const SKILLS: { name: string; desc: string }[] = [
  { name: 'plan-ticket', desc: 'Explore the code and write a plan file' },
  { name: 'brainstorm', desc: 'Explore options for a ticket into a brainstorm record' },
  { name: 'write-plan', desc: 'Turn a brainstorm into a plan record' },
  { name: 'create-ticket', desc: 'Draft a Jira ticket for a project' },
  { name: 'rebase', desc: 'Rebase a branch and resolve what comes up' },
  { name: 'fix-tests', desc: 'Find why tests fail and fix them' },
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

/** One entry of the #/! action search: an action and the item(s) it runs on. */
interface ActionOption {
  key: string;
  action: Action;
  items: Item[];
  /** who it is for, e.g. "@CTX-4821" or "3 items" */
  target: string;
}

type Popup =
  | { type: 'mention'; start: number; query: string; options: Item[]; hits: string[] }
  | { type: 'skill'; start: number; query: string; options: typeof SKILLS }
  | { type: 'action'; start: number; query: string; options: ActionOption[] }
  | null;

/** Actions of everything mentioned: the joint ones first (for several items), then per item. */
function actionOptions(mentioned: Item[], query: string): ActionOption[] {
  const out: ActionOption[] = [];
  if (mentioned.length > 1) {
    const all = actionsForSelection(mentioned.map((m) => m.id));
    all.actions.forEach((a) => out.push({ key: `all:${a.id}`, action: a, items: all.items, target: `${all.items.length} items` }));
  }
  for (const m of mentioned) actionsForItem(m).forEach((a) => out.push({ key: `${m.id}:${a.id}`, action: a, items: [m], target: `@${m.handle}` }));
  const q = query.toLowerCase();
  return out
    .filter((o) => !q || [o.action.label, o.action.skill ?? '', o.target].some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => Number(!!a.action.disabled) - Number(!!b.action.disabled) || Number(b.action.label.toLowerCase().startsWith(q)) - Number(a.action.label.toLowerCase().startsWith(q)))
    .slice(0, 9);
}

const TOKEN = /(@[^\s@]+|(?:^|(?<=\s))\/[\w-]+)/g;

export function ChatBox() {
  const draft = useStore((s) => s.draft);
  const items = useStore((s) => s.items);
  const selected = useStore((s) => s.selected);
  const focusTick = useStore((s) => s.focusTick);
  const visible = useVisible();
  const colors = useItemColors();
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
        .filter((i) => (visible.has(i.id) || !i.archived) && (i.handle.toLowerCase().includes(q) || i.title.toLowerCase().includes(q)))
        .sort(
          (a, b) =>
            Number(visible.has(b.id)) - Number(visible.has(a.id)) ||
            Number(selected.includes(b.id)) - Number(selected.includes(a.id)) ||
            Number(b.handle.toLowerCase().startsWith(q)) - Number(a.handle.toLowerCase().startsWith(q)),
        );
      setPopup({ type: 'mention', start: pos - m[2].length - 1, query: m[2], options: options.slice(0, 7), hits: options.filter((o) => visible.has(o.id)).map((o) => o.id) });
      setActive(0);
      return;
    }
    const a = before.match(/(^|\s)[#!]([\w-]*)$/);
    if (a) {
      const ment = mentionedIds(text, items).map((id) => items.find((i) => i.id === id)!);
      setPopup({ type: 'action', start: pos - a[2].length - 1, query: a[2], options: actionOptions(ment, a[2]) });
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
    if (popup.type === 'action') {
      const o = popup.options[i];
      if (o.action.disabled) return;
      // drop the "#query" token, then run the action (skills write into the draft themselves)
      const end = popup.start + 1 + popup.query.length;
      const head = draft.slice(0, popup.start).replace(/\s+$/, '');
      const tail = draft.slice(end).replace(/^\s+/, '');
      setDraft(head && tail ? `${head} ${tail}` : head ? `${head} ` : tail);
      setPopup(null);
      o.action.run(o.items);
      return;
    }
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

  // the @-query's matches light up on the canvas, the keyboard-active one strongest
  const hits = popup?.type === 'mention' ? popup.hits : null;
  const activeId = popup?.type === 'mention' ? popup.options[active]?.id ?? null : null;
  useEffect(() => {
    setSearch(hits ? { ids: hits, active: activeId } : null);
  }, [hits, activeId]);
  useEffect(() => () => setSearch(null), []);

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
          <mark key={i} className={`tok tok-mention ${it ? '' : 'is-unknown'}`} style={it ? { ['--accent' as string]: accentOf(colors, it.id) } : undefined}>
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
  }, [draft, handles, colors]);

  const syncScroll = () => {
    if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop;
  };

  const placeholder = selected.length
    ? 'Ask about the selection, or pick an action above…'
    : 'Ask Cortex anything — @ to mention a bubble, / for a skill, # for its actions';
  // the border takes the colours of what the message is about
  const ctxColors = [...new Set(mentioned.flatMap((m) => colors.get(m.id) ?? [NEUTRAL_ACCENT]))];

  return (
    <div className="chat-dock">
      {sel.items.length > 0 && (
        <div className="chat-actions" key={selected.join(',')}>
          <span className="chat-actions-for">
            {sel.items.length === 1 ? (
              <>
                {kindIcon(sel.items[0].kind, 14)}
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

      <div
        className={`chatbox ${popup ? 'has-popup' : ''} ${ctxColors.length ? 'has-context' : ''}`}
        style={ctxColors.length ? { ['--ctx-border' as string]: stripes(ctxColors) } : undefined}
      >
        {mentioned.length > 0 && (
          <div className="chat-context">
            <span className="chat-context-label">Context</span>
            {mentioned.map((m) => (
              <button key={m.id} className="ctx-chip" style={{ ['--accent' as string]: stripes(colors.get(m.id) ?? [NEUTRAL_ACCENT], 180) }} onClick={() => camera.focus([m.id])} title={`${kindLabel(m.kind)} · ${m.title}`}>
                {kindIcon(m.kind, 12)}
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
                setDraft(e.target.value, true);
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

        {popup && (popup.options.length > 0 || popup.type === 'action') && (
          <div className="chat-popup" role="listbox" style={{ left: Math.min(popupX(draft, caret), 380) }}>
            <div className="chat-popup-head">
              {popup.type === 'mention' ? (
                <>
                  Mention a bubble
                  {popup.query && <span className="chat-popup-count">{popup.hits.length} on the canvas</span>}
                </>
              ) : popup.type === 'skill' ? (
                'Insert a skill'
              ) : mentioned.length ? (
                `Actions for ${mentioned.length === 1 ? '@' + mentioned[0].handle : mentioned.length + ' items'}`
              ) : (
                'Actions'
              )}
            </div>
            {popup.type === 'action' && popup.options.length === 0 && (
              <div className="chat-popup-empty">{mentioned.length ? 'No matching actions' : 'Mention or select a bubble first, then # searches its actions'}</div>
            )}
            {popup.type === 'action'
              ? popup.options.map((o, i) => (
                  <div
                    key={o.key}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={!!o.action.disabled}
                    className={`chat-option ${i === active ? 'is-active' : ''} ${o.action.disabled ? 'is-disabled' : ''}`}
                    onMouseDown={(e) => (e.preventDefault(), accept(i))}
                    onMouseEnter={() => setActive(i)}
                    title={o.action.disabled}
                  >
                    <span className="chat-option-icon is-action">{o.action.icon}</span>
                    <span className="chat-option-main chat-option-label">{o.action.label}</span>
                    <span className="chat-option-sub">{o.action.disabled ?? (o.action.skill ? `/${o.action.skill} · ${o.target}` : o.target)}</span>
                  </div>
                ))
              : popup.type === 'mention'
              ? popup.options.map((o, i) => (
                  <div
                    key={o.id}
                    role="option"
                    aria-selected={i === active}
                    className={`chat-option ${i === active ? 'is-active' : ''}`}
                    onMouseDown={(e) => (e.preventDefault(), accept(i))}
                    onMouseEnter={() => setActive(i)}
                    style={{ ['--accent' as string]: accentOf(colors, o.id) }}
                  >
                    <span className="chat-option-icon">{kindIcon(o.kind, 14)}</span>
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
                    <span className="chat-option-icon">{skillIcon(o.name)}</span>
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
