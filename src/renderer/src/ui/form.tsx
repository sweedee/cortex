/**
 * `openForm(spec)`: a modal form for UI actions (settings, "create PR…", "change status…").
 * Rendered by `<FormHost />` (mounted once in overlays/Dialogs.tsx); forms stack over other
 * dialogs. Validation (required, choices, custom `validate`) runs on submit and then live;
 * `onSubmit` may be async: the button shows a spinner and a thrown error stays in the dialog.
 *
 *   openForm({
 *     title: 'Create pull request',
 *     fields: [
 *       { name: 'title', label: 'Title', type: 'text', required: true },
 *       { name: 'draft', label: 'Draft', type: 'checkbox' },
 *       { name: 'dir', label: 'Folder', type: 'directory' },    // native picker
 *     ],
 *     submitLabel: 'Create',
 *     onSubmit: async (v) => { await ghOps.prCreate({ … title: str(v, 'title'), draft: v.draft === true }) },
 *   });
 *
 * Resolves with the submitted values, or null when cancelled.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Checkbox, FormField, Label, Radio, RadioGroup, Select, TextArea, TextInput } from '@dynatrace/strato-components/forms';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import { FolderOpenIcon } from '@dynatrace/strato-icons';
import { native } from '../native';
import { isComposing, useAutoFocus } from './focus';
import { errorText } from './task';
import { cleanValues, initialValues, isVisible, optionsOf, validateForm, type FieldValue, type FormFieldSpec, type FormSpec, type FormValues } from './formModel';

export * from './formModel';

interface OpenForm {
  id: number;
  spec: FormSpec;
  resolve: (v: FormValues | null) => void;
  /** set by the mounted dialog: fill values / submit programmatically (the smoke harness) */
  drive?: { fill: (patch: FormValues) => Promise<void>; submit: () => Promise<string | null>; values: () => FormValues };
}

let stack: OpenForm[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Show a form; resolves with the submitted (trimmed) values, or null if cancelled. */
export function openForm(spec: FormSpec): Promise<FormValues | null> {
  return new Promise((resolve) => {
    stack = [...stack, { id: ++seq, spec, resolve }];
    emit();
  });
}

function closeForm(id: number, result: FormValues | null) {
  const f = stack.find((x) => x.id === id);
  stack = stack.filter((x) => x.id !== id);
  emit();
  f?.resolve(result);
}

/**
 * The open forms, newest last, for the dev smoke harness (`debug.ts`): read the title / values,
 * fill fields and submit as if clicked. `submit` resolves with the validation or submit error
 * (the dialog stays open then), or null when the form closed.
 */
export const formDriver = {
  open: () => stack.map((f) => ({ title: f.spec.title, values: f.drive?.values() ?? null })),
  async submit(patch: FormValues = {}, title?: string | RegExp): Promise<string | null> {
    const f = [...stack].reverse().find((x) => !title || (typeof title === 'string' ? x.spec.title.includes(title) : title.test(x.spec.title)));
    if (!f?.drive) throw new Error(`no open form${title ? ` matching ${String(title)}` : ''} (open: ${stack.map((x) => x.spec.title).join(' | ') || 'none'})`);
    await f.drive.fill(patch);
    return f.drive.submit();
  },
  cancel(title?: string) {
    const f = [...stack].reverse().find((x) => !title || x.spec.title.includes(title));
    if (f) closeForm(f.id, null);
  },
};

/** Renders the open forms. Mount once. */
export function FormHost() {
  const forms = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => stack,
  );
  return (
    <>
      {forms.map((f) => (
        <FormDialog key={f.id} form={f} />
      ))}
    </>
  );
}

function FormDialog({ form }: { form: OpenForm }) {
  const { spec } = form;
  const [first] = useState<FormValues>(() => initialValues(spec.fields, spec.values));
  const [values, setValues] = useState<FormValues>(first);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Strato inputs have no autoFocus: focus the first field as the form mounts
  const body = useAutoFocus<HTMLDivElement>();
  // the newest values, also between a change and the next render (derive / submit read it)
  const latest = useRef(first);

  const set = (name: string, v: FieldValue) => {
    const next = { ...latest.current, [name]: v };
    latest.current = next;
    setValues(next);
    if (tried) setErrors(validateForm(spec.fields, next));
    return next;
  };
  /** after a "finished" change (picked, chosen, blurred): derived fields */
  const derive = async (name: string, next: FormValues = latest.current) => {
    if (!spec.onChange) return;
    try {
      const patch = await spec.onChange(name, next);
      if (patch) {
        const merged = { ...latest.current, ...(patch as FormValues) };
        latest.current = merged;
        setValues(merged);
      }
    } catch (e) {
      console.warn('[form] onChange failed', e);
    }
  };

  const busyRef = useRef(false);
  const submit = async (): Promise<string | null> => {
    if (busyRef.current) return 'busy';
    setTried(true);
    const errs = validateForm(spec.fields, latest.current);
    setErrors(errs);
    if (Object.keys(errs).length) return Object.entries(errs).map(([k, v]) => `${k}: ${v}`).join('; ');
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const clean = cleanValues(latest.current);
    try {
      await spec.onSubmit(clean);
      closeForm(form.id, clean);
      return null;
    } catch (e) {
      setFailure(errorText(e));
      busyRef.current = false;
      setBusy(false);
      return errorText(e);
    }
  };
  // programmatic access for the smoke harness (formDriver); refreshed after every render
  useEffect(() => {
    form.drive = {
      values: () => latest.current,
      // like typing: set, run the derived-field hook, then re-apply what was given explicitly
      fill: async (patch) => {
        for (const [k, v] of Object.entries(patch)) set(k, v);
        for (const k of Object.keys(patch)) await derive(k);
        for (const [k, v] of Object.entries(patch)) set(k, v);
      },
      submit,
    };
  });
  const cancel = () => !busy && closeForm(form.id, null);

  return (
    <Modal
      title={spec.title}
      show
      size="small"
      onDismiss={cancel}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="accent" color={spec.danger ? 'critical' : 'primary'} loading={busy} onClick={() => void submit()}>
            {spec.submitLabel ?? 'Save'}
          </Button>
        </Flex>
      }
    >
      <div ref={body} className="form-body">
        {spec.description && <Text className="subdued">{spec.description}</Text>}
        {spec.fields
          .filter((f) => isVisible(f, values))
          .map((f) => (
            <Field key={f.name} field={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => set(f.name, v)} onCommit={(next) => void derive(f.name, next)} onEnter={() => void submit()} />
          ))}
        {failure && (
          <div className="form-failure" role="alert">
            {failure}
          </div>
        )}
      </div>
    </Modal>
  );
}

interface FieldProps {
  field: FormFieldSpec;
  value: FieldValue | undefined;
  error?: string;
  onChange: (v: FieldValue) => FormValues;
  /** a finished change: derived values may follow */
  onCommit: (next?: FormValues) => void;
  onEnter: () => void;
}

function Field({ field: f, value, error, onChange, onCommit, onEnter }: FieldProps) {
  const s = typeof value === 'string' ? value : '';
  const pick = async () => {
    const picked =
      f.type === 'directory'
        ? await native.dialog.pickDirectory({ title: f.label, defaultPath: s || undefined })
        : await native.dialog.pickFile({ title: f.label, defaultPath: s || undefined, filters: f.filters });
    if (picked) onCommit(onChange(picked));
  };
  let control;
  switch (f.type) {
    case 'info':
      return (
        <div className="form-field form-info">
          <div className="form-info-label">{f.label}</div>
          <div className="form-info-value">{s || '–'}</div>
          {f.hint && <div className="form-hint">{f.hint}</div>}
        </div>
      );
    case 'textarea':
      control = <TextArea rows={f.rows ?? 4} value={s} placeholder={f.placeholder} onChange={(v: string) => onChange(v)} onBlur={() => onCommit()} />;
      break;
    case 'checkbox':
      return (
        <div className="form-field">
          <Checkbox name={f.name} value={value === true} onChange={(c: boolean) => onCommit(onChange(c))}>
            {f.label}
          </Checkbox>
          {f.hint && <div className="form-hint">{f.hint}</div>}
          {error && <div className="form-error">{error}</div>}
        </div>
      );
    case 'select':
      control = (
        <Select<string> value={s || null} onChange={(v) => onCommit(onChange(v ?? ''))}>
          <Select.Content>
            {optionsOf(f).map((o) => (
              <Select.Option key={o.value} value={o.value}>
                {o.label}
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
      );
      break;
    case 'radio':
      control = (
        <RadioGroup name={f.name} value={s || null} onChange={(v: string) => onCommit(onChange(v))}>
          {optionsOf(f).map((o) => (
            <Radio key={o.value} value={o.value}>
              {o.hint ? `${o.label} — ${o.hint}` : o.label}
            </Radio>
          ))}
        </RadioGroup>
      );
      break;
    case 'directory':
    case 'file':
      control = (
        <Flex gap={6} alignItems="center">
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextInput value={s} placeholder={f.placeholder ?? (f.type === 'directory' ? 'Pick a folder…' : 'Pick a file…')} onChange={(v: string) => onChange(v)} onBlur={() => onCommit()} />
          </div>
          <Button onClick={() => void pick()} aria-label={`Browse for ${f.label}`}>
            <Button.Prefix>
              <FolderOpenIcon />
            </Button.Prefix>
            Browse…
          </Button>
        </Flex>
      );
      break;
    default:
      control = (
        <TextInput
          value={s}
          placeholder={f.placeholder}
          onChange={(v: string) => onChange(v)}
          onBlur={() => onCommit()}
          onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && !isComposing(e) && onEnter()}
        />
      );
  }
  return (
    <div className="form-field">
      <FormField required={f.required}>
        <Label>{f.label}</Label>
        {control}
      </FormField>
      {f.hint && <div className="form-hint">{f.hint}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
