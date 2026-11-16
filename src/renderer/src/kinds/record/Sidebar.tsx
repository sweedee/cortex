/** Record sidebar: live markdown viewer of the file, with an edit mode (CodeMirror, Ctrl+S). */
import { useEffect, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { EditIcon, ViewIcon } from '@dynatrace/strato-icons';
import { CodeEditor, Markdown, toggleTask } from '../../components/viewers';
import { patchData } from '../../store';
import { errorText, openUrl } from '../../ui/task';
import { ConnectionsSection, FactsSection, SidebarSection, SummarySection } from '../../sidebar';
import { toast } from '../common';
import type { SidebarProps } from '../types';
import { countSteps, RECORD_HINT } from './model';
import { isAbsolutePath } from '../../../../shared/paths';
import { useRecordFile } from './useRecordFile';
import './record.css';

function RecordView({ item, ctx }: SidebarProps<'record'>) {
  const file = useRecordFile(item.data.path);
  const real = isAbsolutePath(item.data.path);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = editing && file.text !== undefined && draft !== file.text;
  const [baseline, setBaseline] = useState<string>();

  // keep the ring's step count in step with the file
  useEffect(() => {
    if (file.text === undefined) return;
    const s = countSteps(file.text);
    const cur = item.data.steps;
    if (s.total > 0 && (cur?.done !== s.done || cur?.total !== s.total)) patchData<'record'>(item.id, { steps: s });
  }, [file.text, item.id, item.data.steps]);

  const startEdit = () => {
    setDraft(file.text ?? '');
    setBaseline(file.text);
    setEditing(true);
  };
  const changedOnDisk = editing && baseline !== undefined && file.text !== undefined && file.text !== baseline && draft !== file.text;

  const save = async (text: string) => {
    setSaving(true);
    try {
      await file.save(text);
      setBaseline(text);
      toast('Saved', item.title);
    } catch (e) {
      toast('Could not save', errorText(e), 'critical');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (index: number, checked: boolean) => {
    if (file.text === undefined) return;
    try {
      await file.save(toggleTask(file.text, index, checked));
    } catch (e) {
      toast('Could not save', errorText(e), 'critical');
    }
  };

  let body;
  if (!real) body = <div className="rec-note">{RECORD_HINT}</div>;
  else if (file.error) body = <div className="rec-note rec-error">{file.error}</div>;
  else if (file.text === undefined) body = <div className="rec-note">{file.loading ? 'Loading…' : 'Not available without the Cortex server.'}</div>;
  else if (editing)
    body = (
      <>
        <div className="rec-toolbar">
          <Button size="condensed" variant="accent" color="primary" disabled={!dirty || saving} onClick={() => void save(draft)}>
            Save
          </Button>
          <Button
            size="condensed"
            onClick={() => {
              setDraft(file.text ?? '');
              setEditing(false);
            }}
          >
            {dirty ? 'Discard' : 'Close editor'}
          </Button>
          <span className="rec-hint">Ctrl+S saves{dirty ? ' · unsaved changes' : ''}</span>
        </div>
        {changedOnDisk && (
          <div className="rec-note">
            The file changed on disk.{' '}
            <Button
              size="condensed"
              onClick={() => {
                setDraft(file.text ?? '');
                setBaseline(file.text);
              }}
            >
              Load the new version
            </Button>
          </div>
        )}
        <CodeEditor value={draft} onChange={setDraft} language="markdown" onSave={(v) => void save(v)} minHeight={360} />
      </>
    );
  else
    body = (
      <>
        <div className="rec-toolbar">
          <Button size="condensed" onClick={startEdit}>
            <Button.Prefix>
              <EditIcon />
            </Button.Prefix>
            Edit
          </Button>
          <span className="rec-hint">
            <ViewIcon size={12} /> live
          </span>
        </div>
        <div className="rec-md">
          {file.text.trim() ? <Markdown source={file.text} onLinkClick={(h) => void openUrl(h)} onToggleTask={(i, c) => void toggle(i, c)} /> : <div className="rec-note">The file is empty.</div>}
        </div>
      </>
    );

  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      <SidebarSection label="Content">{body}</SidebarSection>
      <FactsSection facts={[['Path', item.data.path], ...(item.data.ticketBranch ? ([['Branch', item.data.ticketBranch]] as [string, string][]) : [])]} />
      <ConnectionsSection item={item} ctx={ctx} />
    </>
  );
}

/** One view per file: the file state resets when the path changes. */
export const RecordSidebar = (props: SidebarProps<'record'>) => <RecordView key={props.item.data.path} {...props} />;
