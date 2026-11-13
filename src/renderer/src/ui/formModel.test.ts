import { describe, expect, it } from 'vitest';
import { answerFields, answersFrom } from '../kinds/agent/session';
import { cleanValues, initialValues, validateForm, type FormFieldSpec } from './formModel';

const fields: FormFieldSpec[] = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'body', label: 'Body', type: 'textarea' },
  { name: 'method', label: 'Method', type: 'radio', options: ['merge', 'squash'], default: 'squash' },
  { name: 'stage', label: 'Stage', type: 'select', options: [{ value: 'dev', label: 'Dev' }], required: true },
  { name: 'sure', label: 'I am sure', type: 'checkbox', required: true },
  { name: 'dir', label: 'Folder', type: 'directory', when: (v) => v.method === 'merge', required: true },
  { name: 'repo', label: 'Repo', type: 'text', validate: (v) => (String(v).includes('/') || !v ? undefined : 'Use owner/name') },
];

describe('form model', () => {
  it('starts from defaults, overridable', () => {
    expect(initialValues(fields)).toEqual({ title: '', body: '', method: 'squash', stage: '', sure: false, dir: '', repo: '' });
    expect(initialValues(fields, { title: 'x', body: undefined }).title).toBe('x');
  });

  it('reports required, choices and custom errors; skips hidden fields', () => {
    const v = { ...initialValues(fields), title: '   ', repo: 'nope' };
    expect(validateForm(fields, v)).toEqual({ title: 'Required', stage: 'Choose one', sure: 'Must be checked', repo: 'Use owner/name' });
    // dir only counts once it is visible
    expect(validateForm(fields, { ...v, method: 'merge' }).dir).toBe('Required');
    expect(validateForm(fields, { ...v, method: 'rebase' }).method).toBe('Not one of the choices');
  });

  it('is valid when filled; values get trimmed', () => {
    const v = { ...initialValues(fields), title: ' Fix ', stage: 'dev', sure: true, repo: 'a/b' };
    expect(validateForm(fields, v)).toEqual({});
    expect(cleanValues(v)).toMatchObject({ title: 'Fix', sure: true });
  });
});

describe('AskUserQuestion form', () => {
  const qs = [
    { question: 'Which approach?', header: 'Approach', options: [{ label: 'Retry' }, { label: 'Queue' }] },
    { question: 'Which tests?', multiSelect: true, options: [{ label: 'Unit' }, { label: 'E2E' }] },
  ];

  it('builds radio / checkbox fields per question', () => {
    const f = answerFields(qs);
    expect(f.map((x) => `${x.name}:${x.type}`)).toEqual(['q0:radio', 'q0other:text', 'q1o0:checkbox', 'q1o1:checkbox', 'q1other:text']);
  });

  it('turns values into answers; own text wins for single choice', () => {
    expect(answersFrom(qs, { q0: 'Queue', q1o0: true, q1o1: true })).toEqual({ 'Which approach?': 'Queue', 'Which tests?': ['Unit', 'E2E'] });
    expect(answersFrom(qs, { q0: 'Queue', q0other: 'Both', q1o1: true, q1other: 'Perf' })).toEqual({ 'Which approach?': 'Both', 'Which tests?': ['E2E', 'Perf'] });
    expect(() => answersFrom(qs, { q0: 'Retry' })).toThrow(/Which tests/);
  });
});
