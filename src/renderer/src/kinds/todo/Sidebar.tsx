/** Todo sidebar: inline title, markdown body editor with preview, debounced autosave. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { CodeEditor, Markdown, toggleTask } from '../../components/viewers';
import { ConnectionsSection, SidebarSection } from '../../sidebar';
import { patchData, patchItem } from '../../store';
import { openUrl } from '../../ui/task';
import type { SidebarProps } from '../types';
import { checklist } from './model';
import './todo.css';

const SAVE_MS = 600;

function TodoEditor({ item, ctx }: SidebarProps<'todo'>) {
  const { id } = item;
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.data.body);
  // opens on the rendered notes; an empty todo starts in the editor
  const [preview, setPreview] = useState(item.data.body.trim() !== '');
  const saved = useRef(item.data.body);
  const latest = useRef(body);
  latest.current = body;

  const flush = () => {
    if (latest.current !== saved.current) {
      saved.current = latest.current;
      patchData<'todo'>(id, { body: latest.current });
    }
  };

  // a change from outside (undo, another view) while we have nothing unsaved
  useEffect(() => {
    if (item.data.body !== saved.current && latest.current === saved.current) {
      saved.current = item.data.body;
      setBody(item.data.body);
    }
  }, [item.data.body]);
  useEffect(() => {
    if (item.title !== title && document.activeElement?.tagName !== 'INPUT') setTitle(item.title);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only follow outside title changes
  }, [item.title]);

  // debounced autosave, and a final save when the sidebar closes / switches item
  useEffect(() => {
    if (body === saved.current) return;
    const t = setTimeout(flush, SAVE_MS);
    return () => clearTimeout(t);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- flush reads refs
  }, [body]);
  useEffect(() => flush, []); // oxlint-disable-line react-hooks/exhaustive-deps

  const commitTitle = () => {
    const t = title.trim();
    if (!t) setTitle(item.title);
    else if (t !== item.title) patchItem(id, { title: t });
  };

  const c = checklist(body);
  return (
    <>
      <SidebarSection>
        <input
          className="todo-title"
          value={title}
          aria-label="Title"
          placeholder="Title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setTitle(item.title);
          }}
        />
        <div className="sidebar-status">
          <Chip size="condensed" color={item.data.done ? 'success' : 'neutral'} variant={item.data.done ? 'emphasized' : undefined}>
            {item.data.done ? 'Done' : 'Open'}
          </Chip>
          {c.total > 0 && (
            <Chip size="condensed" color="neutral">
              {c.done} / {c.total} checked
            </Chip>
          )}
        </div>
      </SidebarSection>
      <SidebarSection
        label="Notes"
        actions={
          <>
            <Button size="condensed" variant={preview ? 'default' : 'accent'} color={preview ? 'neutral' : 'primary'} onClick={() => setPreview(false)}>
              Edit
            </Button>{' '}
            <Button size="condensed" variant={preview ? 'accent' : 'default'} color={preview ? 'primary' : 'neutral'} onClick={() => setPreview(true)}>
              Preview
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="todo-preview">
            {body.trim() ? (
              <Markdown
                source={body}
                onLinkClick={(h) => void openUrl(h)}
                onToggleTask={(i, checked) => {
                  const next = toggleTask(body, i, checked);
                  latest.current = next;
                  setBody(next);
                  flush();
                }}
              />
            ) : (
              <div className="todo-empty">Nothing written yet.</div>
            )}
          </div>
        ) : (
          <CodeEditor value={body} onChange={setBody} language="markdown" minHeight={220} placeholder="Markdown. Use - [ ] for a checklist." onSave={() => flush()} />
        )}
        <div className="todo-hint">Saved automatically.</div>
      </SidebarSection>
      <ConnectionsSection item={item} ctx={ctx} />
    </>
  );
}

export function TodoSidebar(props: SidebarProps<'todo'>) {
  return <TodoEditor key={props.item.id} {...props} />;
}
