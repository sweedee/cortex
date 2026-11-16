/**
 * The folder / file picker: a modal that browses the server's disk (`native.dialog.listDir`) and
 * resolves with the path `native.dialog.confirmPick` returns, or null when cancelled. Registered
 * with `setPicker` by `<PickerHost />` (mounted once in main.tsx); picks stack over other dialogs.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { ProgressCircle } from '@dynatrace/strato-components/content';
import { FolderOpenIcon } from '@dynatrace/strato-icons';
import type { DirListing } from '../../../shared/ipc';
import { native, setPicker, type PickRequest } from '../native';
import { isComposing } from './focus';
import { crumbs, joinPath, visibleEntries } from './pickerModel';
import { errorText } from './task';

interface OpenPick {
  id: number;
  req: PickRequest;
  resolve: (path: string | null) => void;
}

let stack: OpenPick[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function open(req: PickRequest): Promise<string | null> {
  return new Promise((resolve) => {
    stack = [...stack, { id: ++seq, req, resolve }];
    emit();
  });
}

function close(id: number, result: string | null) {
  const p = stack.find((x) => x.id === id);
  stack = stack.filter((x) => x.id !== id);
  emit();
  p?.resolve(result);
}

/** Renders the open pickers and registers them as `native`'s picker. Mount once. */
export function PickerHost() {
  const picks = useSyncExternalStore(subscribe, () => stack);
  useEffect(() => setPicker(open), []);
  return (
    <>
      {picks.map((p) => (
        <PickerDialog key={p.id} pick={p} />
      ))}
    </>
  );
}

function PickerDialog({ pick }: { pick: OpenPick }) {
  const { req } = pick;
  const kind = req.kind;
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const seqRef = useRef(0);

  /** list `path` (home when undefined); on failure keep the current folder and show why */
  const go = useCallback(async (path?: string, fallbackHome = false) => {
    const n = ++seqRef.current;
    setBusy(true);
    try {
      let l: DirListing;
      try {
        l = await native.dialog.listDir(path ? { path } : {});
      } catch (e) {
        if (!fallbackHome) throw e;
        l = await native.dialog.listDir({});
      }
      if (n !== seqRef.current) return;
      setListing(l);
      setTyped(l.path);
      setSelected(null);
      setError(null);
    } catch (e) {
      if (n === seqRef.current) setError(errorText(e));
    } finally {
      if (n === seqRef.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    // a file default: start in its folder
    const d = req.defaultPath;
    const start = d && kind === 'file' ? d.replace(/[\\/][^\\/]*$/, '') || d : d;
    void Promise.resolve().then(() => go(start || undefined, true));
  }, [go, req.defaultPath, kind]);

  const choose = async (path: string) => {
    setBusy(true);
    try {
      close(pick.id, await native.dialog.confirmPick({ path, kind }));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  /** what Select would pick: the clicked file, else the typed path (a folder pick takes the listed folder) */
  const target = selected ?? (typed.trim() || listing?.path || '');
  const submit = () => {
    if (!busy && target) void choose(target);
  };
  const entries = listing ? visibleEntries(listing.entries, kind, req.filters) : [];
  const title = req.title ?? (kind === 'dir' ? 'Choose a folder' : 'Choose a file');

  return (
    <Modal
      title={title}
      show
      size="small"
      onDismiss={() => close(pick.id, null)}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={() => close(pick.id, null)}>Cancel</Button>
          <Button variant="accent" disabled={busy || !target} onClick={submit}>
            Select
          </Button>
        </Flex>
      }
    >
      <div className="picker">
        {listing && (
          <div className="picker-crumbs" aria-label="Path">
            {crumbs(listing.path).map((c, i) => (
              <button key={c.path} type="button" className="picker-crumb" disabled={busy} onClick={() => void go(c.path)}>
                {i > 1 && <span aria-hidden> / </span>}
                {c.label}
              </button>
            ))}
          </div>
        )}
        <Flex gap={6} alignItems="center">
          <Button aria-label="Parent folder" disabled={busy || !listing?.parent} onClick={() => listing?.parent && void go(listing.parent)}>
            Up
          </Button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              aria-label="Path"
              value={typed}
              placeholder={kind === 'dir' ? 'Type a folder path…' : 'Type a file path…'}
              onChange={(v: string) => {
                setTyped(v);
                setSelected(null);
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key !== 'Enter' || isComposing(e)) return;
                e.preventDefault();
                // Enter in the field: a folder pick takes it, a file pick browses into a folder (or picks the file)
                if (kind === 'dir') submit();
                else
                  void native.dialog.listDir({ path: typed.trim() }).then(
                    (l) => go(l.path),
                    () => submit(),
                  );
              }}
            />
          </div>
        </Flex>
        <div className="picker-list" role="listbox" aria-label="Folder contents">
          {busy && !listing && <ProgressCircle size="small" aria-label="Loading" />}
          {listing && entries.length === 0 && <div className="picker-empty">{kind === 'dir' ? 'No subfolders' : 'Nothing to pick here'}</div>}
          {entries.map((e) => {
            const path = joinPath(listing!.path, e.name);
            return e.dir ? (
              <button key={e.name} type="button" role="option" aria-selected={false} className="picker-row" disabled={busy} onClick={() => void go(path)}>
                <FolderOpenIcon /> <span className="picker-name">{e.name}</span>
              </button>
            ) : (
              <button
                key={e.name}
                type="button"
                role="option"
                aria-selected={selected === path}
                className={`picker-row picker-file${selected === path ? ' is-selected' : ''}`}
                disabled={busy}
                onClick={() => {
                  setSelected(path);
                  setTyped(path);
                }}
                onDoubleClick={() => void choose(path)}
              >
                <span className="picker-name">{e.name}</span>
              </button>
            );
          })}
          {listing?.truncated && <div className="picker-empty">Only the first entries are shown. Type the path instead.</div>}
        </div>
        {error && (
          <div className="form-failure" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
