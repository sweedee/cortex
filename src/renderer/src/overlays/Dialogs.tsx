import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { FormField, Label, TextArea, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import { showToast } from '@dynatrace/strato-components/notifications';
import { KINDS_ADDABLE } from '../actions';
import type { ItemOf, Kind } from '../domain';
import { getKind, kindIcon, kindLabel, KINDS } from '../kinds/registry';
import { place } from '../layout';
import { addItem, closeDialog, makeItem, select, useStore } from '../store';
import { isComposing, useAutoFocus } from '../ui/focus';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'add':
      return <AddDialog key={dialog.kind + dialog.at.x} kind={dialog.kind} at={dialog.at} />;
    case 'confirm':
      return (
        <Modal
          title={dialog.title}
          show
          size="small"
          onDismiss={closeDialog}
          footer={
            <Flex justifyContent="flex-end" gap={8}>
              <Button onClick={closeDialog}>Cancel</Button>
              <Button
                variant="accent"
                color={dialog.danger ? 'critical' : 'primary'}
                onClick={() => {
                  closeDialog();
                  dialog.onConfirm();
                }}
              >
                {dialog.confirm}
              </Button>
            </Flex>
          }
        >
          <Text>{dialog.body}</Text>
        </Modal>
      );
  }
}

// ---- add / import -----------------------------------------------------------------------

/** Guess what a pasted reference is (the first kind whose `addable.detect` matches). */
function detect(v: string): Kind | null {
  return v ? (KINDS.find((k) => getKind(k).addable?.detect?.(v)) ?? null) : null;
}

function AddDialog({ kind: initial, at }: { kind: Kind; at: { x: number; y: number } }) {
  const items = useStore((s) => s.items);
  const projects = items.filter((i): i is ItemOf<'project'> => i.kind === 'project');
  const [kind, setKind] = useState<Kind>(initial);
  const [value, setValue] = useState('');
  const [project, setProject] = useState<string | null>(projects[0]?.id ?? null);
  const meta = getKind(kind).addable!;
  const guessed = detect(value.trim());
  // Strato inputs have no autoFocus prop: focus the field as it mounts (again when its type flips)
  const field = useAutoFocus<HTMLDivElement>(!!meta.multiline);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    const linkLabel = meta.linkLabel ?? 'belongs to';
    const proj = linkLabel ? projects.find((p) => p.id === project) : undefined;
    const item = makeItem({ ...meta.create(v, proj), ...(proj && { projectId: proj.id }) });
    place.seed(item.id, at);
    addItem(item, proj && linkLabel ? [{ from: item.id, to: proj.id, label: linkLabel }] : []);
    closeDialog();
    select([item.id]);
    showToast({ type: 'success', title: `${kindLabel(kind)} added`, message: item.title, lifespan: 2500 });
  };

  return (
    <Modal
      title={
        <Flex alignItems="center" gap={8}>
          {kindIcon(kind, 20)}
          <span>{meta.label.replace('…', '')}</span>
        </Flex>
      }
      show
      size="small"
      onDismiss={closeDialog}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="accent" color="primary" disabled={!value.trim()} onClick={submit}>
            Add to canvas
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <Flex gap={6} flexWrap="wrap">
          {KINDS_ADDABLE.map((k) => (
            <Button
              key={k.kind}
              size="condensed"
              variant={k.kind === kind ? 'accent' : 'default'}
              color={k.kind === kind ? 'primary' : 'neutral'}
              onClick={() => {
                // kinds with their own add flow (project settings, the chat box) leave this dialog
                const open = getKind(k.kind).addable?.open;
                if (open && k.kind !== kind) {
                  closeDialog();
                  open(at);
                } else setKind(k.kind);
              }}
            >
              <Button.Prefix>{kindIcon(k.kind, 14)}</Button.Prefix>
              {kindLabel(k.kind)}
            </Button>
          ))}
        </Flex>
        <div ref={field}>
          <FormField>
            <Label>{meta.multiline ? 'Text' : 'Reference'}</Label>
            {meta.multiline ? (
              <TextArea rows={3} value={value} onChange={setValue} placeholder={meta.hint} />
            ) : (
              <TextInput
                value={value}
                onChange={(v: string) => {
                  setValue(v);
                  const g = detect(v.trim());
                  if (g && g !== kind) setKind(g);
                }}
                placeholder={meta.hint}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && !isComposing(e) && submit()}
              />
            )}
          </FormField>
        </div>
        {guessed && guessed === kind && value && (
          <Text textStyle="small" className="subdued">
            Looks like a {kindLabel(guessed).toLowerCase()}, switched type for you.
          </Text>
        )}
        {meta.linkLabel !== false && (
          <FormField>
            <Label>Link to project</Label>
            <Flex gap={6} flexWrap="wrap">
              {projects.map((p) => (
                <Button
                  key={p.id}
                  size="condensed"
                  variant={p.id === project ? 'emphasized' : 'default'}
                  color={p.id === project ? 'primary' : 'neutral'}
                  onClick={() => setProject(p.id === project ? null : p.id)}
                >
                  {p.title}
                </Button>
              ))}
            </Flex>
          </FormField>
        )}
      </Flex>
    </Modal>
  );
}
