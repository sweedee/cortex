import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { tags as t } from '@lezer/highlight';
import '../viewers.css';

export type EditorLanguage = 'markdown' | 'json' | 'text';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  placeholder?: string;
  /** Called on Ctrl/Cmd+S with the current value. */
  onSave?: (value: string) => void;
  /** CSS length, e.g. 160 or '12rem'. */
  minHeight?: number | string;
  /** Show line numbers (default false for markdown/text, true for json). */
  lineNumbers?: boolean;
  className?: string;
}

const C = (name: string) => `var(--dt-colors-${name})`;

/** Editor chrome from Strato tokens, so it follows the app's light/dark theme automatically. */
const theme = EditorView.theme({
  '&': { color: C('text-neutral-default'), backgroundColor: C('background-field-neutral-default'), fontSize: '13px' },
  '&.cm-focused': { outline: `1px solid ${C('border-primary-default')}` },
  '.cm-scroller': { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", lineHeight: '1.5' },
  '.cm-content': { caretColor: C('text-neutral-default'), padding: '6px 0' },
  '.cm-cursor': { borderLeftColor: C('text-neutral-default') },
  '.cm-gutters': { backgroundColor: 'transparent', color: C('text-neutral-subdued'), border: 'none' },
  '.cm-activeLine': { backgroundColor: C('background-container-neutral-subdued') },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: C('background-container-primary-emphasized') },
  '.cm-placeholder': { color: C('text-neutral-subdued') },
});

const highlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4], fontWeight: '600', color: C('text-primary-default') },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: C('text-primary-default') },
  { tag: [t.monospace, t.string], color: C('text-success-default') },
  { tag: [t.number, t.bool, t.null, t.keyword], color: C('text-warning-default') },
  { tag: [t.propertyName, t.atom], color: C('text-primary-default') },
  { tag: [t.quote, t.comment, t.processingInstruction, t.contentSeparator, t.meta], color: C('text-neutral-subdued') },
]);

function languageExt(language: EditorLanguage | undefined): Extension {
  if (language === 'markdown') return markdown();
  if (language === 'json') return json();
  return [];
}

export default function CodeEditorImpl({ value, onChange, language = 'text', readOnly, placeholder, onSave, minHeight = 120, lineNumbers: showNumbers, className }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };
  const initial = useRef(value);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const gutter = useRef(new Compartment());
  const ph = useRef(new Compartment());
  const wantNumbers = showNumbers ?? language === 'json';

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: (ev) => (cb.current.onSave ? (cb.current.onSave(ev.state.doc.toString()), true) : false) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          theme,
          syntaxHighlighting(highlight),
          lang.current.of(languageExt(language)),
          ro.current.of(EditorState.readOnly.of(!!readOnly)),
          gutter.current.of(wantNumbers ? lineNumbers() : []),
          ph.current.of(placeholder ? placeholderExt(placeholder) : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The view is created once; props below are reconfigured by the effects that follow.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        lang.current.reconfigure(languageExt(language)),
        ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)),
        gutter.current.reconfigure(wantNumbers ? lineNumbers() : []),
        ph.current.reconfigure(placeholder ? placeholderExt(placeholder) : []),
      ],
    });
  }, [language, readOnly, wantNumbers, placeholder]);

  return <div ref={host} className={`cxv-editor${className ? ` ${className}` : ''}`} style={{ minHeight }} />;
}
