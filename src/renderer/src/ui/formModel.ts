/**
 * The model behind `openForm` (ui/form.tsx): field specs, initial values and validation.
 * Pure (no React), so it is unit-tested on its own.
 */

export type FieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'directory' | 'file' | 'radio';

export type FieldValue = string | boolean;
/** Values by field name: strings for every type except `checkbox` (boolean). */
export type FormValues = Record<string, FieldValue>;

export interface FieldOption {
  value: string;
  label: string;
  /** second line (radio) */
  hint?: string;
}

export interface FormFieldSpec {
  name: string;
  label: string;
  type: FieldType;
  /** select / radio choices; plain strings are value = label */
  options?: (FieldOption | string)[];
  required?: boolean;
  default?: FieldValue;
  /** help text under the field */
  hint?: string;
  placeholder?: string;
  /** extra check; return the error message */
  validate?: (value: FieldValue, values: FormValues) => string | undefined;
  /** shown only when this returns true (hidden fields are not validated) */
  when?: (values: FormValues) => boolean;
  /** `file` fields: picker filters */
  filters?: { name: string; extensions: string[] }[];
  /** textarea rows (default 4) */
  rows?: number;
}

export interface FormSpec {
  title: string;
  /** a line of text above the fields */
  description?: string;
  fields: FormFieldSpec[];
  /** starting values (override the fields' defaults) */
  values?: Partial<FormValues>;
  /** default "Save" */
  submitLabel?: string;
  /** submit button in red */
  danger?: boolean;
  /**
   * Called after a field changed (typed, picked); the returned patch is merged into the values.
   * Use it for derived fields, e.g. detecting the repo of a picked directory.
   */
  onChange?: (name: string, values: FormValues) => Partial<FormValues> | void | Promise<Partial<FormValues> | void>;
  /** Throw to keep the dialog open and show the error message. */
  onSubmit: (values: FormValues) => void | Promise<void>;
}

export const optionsOf = (f: FormFieldSpec): FieldOption[] => (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

/** Starting values: each field's `default`, else `false` (checkbox) / `''`. */
export function initialValues(fields: FormFieldSpec[], override: Partial<FormValues> = {}): FormValues {
  const out: FormValues = {};
  for (const f of fields) out[f.name] = f.default ?? (f.type === 'checkbox' ? false : '');
  for (const [k, v] of Object.entries(override)) if (v !== undefined) out[k] = v;
  return out;
}

export const isVisible = (f: FormFieldSpec, values: FormValues) => !f.when || f.when(values);

/** Error message per field name (empty object = valid). Hidden fields are skipped. */
export function validateForm(fields: FormFieldSpec[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!isVisible(f, values)) continue;
    const v = values[f.name];
    if (f.required) {
      if (f.type === 'checkbox' ? v !== true : typeof v !== 'string' || !v.trim()) {
        errors[f.name] = f.type === 'checkbox' ? 'Must be checked' : f.type === 'select' || f.type === 'radio' ? 'Choose one' : 'Required';
        continue;
      }
    }
    if ((f.type === 'select' || f.type === 'radio') && typeof v === 'string' && v && !optionsOf(f).some((o) => o.value === v)) {
      errors[f.name] = 'Not one of the choices';
      continue;
    }
    const custom = v === undefined ? undefined : f.validate?.(v, values);
    if (custom) errors[f.name] = custom;
  }
  return errors;
}

/** Values with strings trimmed (what `onSubmit` receives). */
export const cleanValues = (values: FormValues): FormValues => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

/** Read a value as a string (`''` for checkboxes / missing). */
export const str = (values: FormValues, name: string) => {
  const v = values[name];
  return typeof v === 'string' ? v : '';
};
