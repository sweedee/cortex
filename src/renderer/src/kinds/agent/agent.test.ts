import { describe, expect, it } from 'vitest';
import type { ClaudeEvent } from '../../../../shared/integrations/claude';
import type { ItemOf } from '../../domain';
import { makeItem } from '../../store';
import { agentActions } from './actions';
import { answersOf, buildRows, contextTone, emptyChoice, groupRows, inputText, isAnswered, toggleChoice, toggleOther, tokens, usd } from './transcript';

const S = 'sess-1';
const ev = (e: object, at = '2026-11-14T10:00:00.000Z') => ({ timestamp: at, session_id: S, ...e }) as ClaudeEvent;
const asst = (content: unknown[], id = 'm1') => ev({ type: 'assistant', parent_tool_use_id: null, message: { id, content } });
const user = (content: unknown) => ev({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content } });

describe('agent transcript rows', () => {
  const events: ClaudeEvent[] = [
    ev({ type: 'system', subtype: 'init', model: 'claude-x' }),
    user('fix the bug'),
    asst([{ type: 'thinking', thinking: 'Let me look at the dispatcher.' }, { type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } }]),
    user([{ type: 'tool_result', tool_use_id: 'tu1', content: 'line 1\nline 2' }]),
    asst([{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' } }], 'm2'),
    asst([{ type: 'tool_use', id: 'ask1', name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', header: 'Pick', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }] } }], 'm3'),
  ];

  it('keeps messages, thinking (in order), tool inputs / results and the open question', () => {
    const rows = buildRows(events, 'x');
    expect(rows.map((r) => r.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'tool', 'question']);
    const read = rows[3];
    expect(read).toMatchObject({ kind: 'tool', tool: 'Read', summary: '/a.ts', status: 'ok', result: 'line 1\nline 2' });
    const edit = rows[4];
    expect(edit).toMatchObject({ kind: 'tool', tool: 'Edit', status: 'running' });
    expect(edit.kind === 'tool' && inputText(edit.tool, edit.input)).toBe('- a\n+ b');
    expect(rows[5]).toMatchObject({ kind: 'question', id: 'ask1', status: 'running', questions: [{ question: 'Which?', multiSelect: true }] });
  });

  it('marks an answered question with its answers', () => {
    const rows = buildRows([...events, user([{ type: 'tool_result', tool_use_id: 'ask1', content: 'User has answered your questions: "Which?"="A, B". You can now continue.' }])]);
    expect(rows.at(-1)).toMatchObject({ kind: 'question', status: 'ok', answers: { 'Which?': 'A, B' } });
  });

  it('groups consecutive tool calls', () => {
    const blocks = groupRows(buildRows(events));
    expect(blocks.map((b) => (b.kind === 'tools' ? `tools:${b.rows.length}` : b.row.kind))).toEqual(['user', 'thinking', 'assistant', 'tools:2', 'question']);
  });

  it('ignores subagent output and empty input', () => {
    expect(buildRows([])).toEqual([]);
    expect(buildRows([ev({ type: 'assistant', parent_tool_use_id: 'tuX', message: { content: [{ type: 'text', text: 'sub' }] } })])).toEqual([]);
    expect(inputText('Bash', { command: 'ls' })).toBe('');
    expect(inputText('Grep', { pattern: 'x', glob: '*.ts' })).toContain('"glob"');
  });
});

describe('question card choices', () => {
  const qs = [
    { question: 'One?', multiSelect: false },
    { question: 'Many?', multiSelect: true },
  ];
  it('single select replaces, multi select toggles, "other" adds free text', () => {
    let a = toggleChoice(emptyChoice, 'X', false);
    a = toggleChoice(a, 'Y', false);
    expect(a.picked).toEqual(['Y']);
    expect(toggleOther(a, false)).toMatchObject({ picked: [], other: true });
    let b = toggleChoice(emptyChoice, 'A', true);
    b = toggleChoice(b, 'B', true);
    b = toggleChoice(b, 'A', true);
    b = { ...toggleOther(b, true), text: ' mine ' };
    expect(isAnswered(emptyChoice)).toBe(false);
    expect(isAnswered({ ...emptyChoice, other: true, text: '  ' })).toBe(false);
    expect(answersOf(qs, [a, b])).toEqual({ 'One?': 'Y', 'Many?': ['B', 'mine'] });
  });
});

describe('status line numbers', () => {
  it('formats', () => {
    expect(usd(0.004)).toBe('<$0.01');
    expect(usd(1.5)).toBe('$1.50');
    expect(tokens(84_000)).toBe('84k');
    expect(tokens(1250)).toBe('1.3k');
    expect([contextTone(50), contextTone(85), contextTone(97)]).toEqual(['normal', 'warning', 'critical']);
  });
});

const agent = (data: Partial<ItemOf<'agent'>['data']>) =>
  makeItem({ kind: 'agent', handle: 'agent/t', title: 'T', data: { cwd: 'C:\\work\\x', status: 'running', localId: 'l1', ...data } }) as ItemOf<'agent'>;
const ids = (a: ItemOf<'agent'>) => agentActions(a).map((x) => x.id);

describe('agent actions', () => {
  it('running real session: interrupt, stop, follow-up, open folder', () => {
    expect(ids(agent({}))).toEqual(['view', 'interrupt', 'stop', 'follow-up', 'continue', 'fork', 'editor', 'folder']);
  });
  it('waiting on a question: one action per option, follow-up disabled', () => {
    const a = agent({ status: 'waiting', pendingQuestion: { toolUseId: 't', questions: [{ question: 'Q', options: [{ label: 'A' }, { label: 'B' }] }] } });
    const as = agentActions(a);
    expect(as.map((x) => x.id).slice(0, 3)).toEqual(['view', 'answer-0', 'answer-1']);
    expect(as.find((x) => x.id === 'follow-up')?.disabled).toBeTruthy();
    expect(as.some((x) => x.id === 'answer')).toBe(false);
  });
  it('multi-question / multi-select also gets "Answer…"', () => {
    const a = agent({ status: 'waiting', pendingQuestion: { toolUseId: 't', questions: [{ question: 'Q', multiSelect: true, options: [{ label: 'A' }] }] } });
    expect(ids(a)).toContain('answer');
  });
  it('pending permissions: allow / deny, allow is primary', () => {
    const a = agent({ status: 'waiting', pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', summary: 'ls' }] });
    const as = agentActions(a);
    expect(as.find((x) => x.id === 'allow-0')).toMatchObject({ label: 'Allow Bash', primary: true });
    expect(as.find((x) => x.id === 'deny-0')).toMatchObject({ label: 'Deny Bash', danger: true });
    expect(as.find((x) => x.id === 'view')?.primary).toBe(false);
  });
  it('finished: no stop; demo agent with a fake path: resume, no folder actions', () => {
    expect(ids(agent({ status: 'done' }))).not.toContain('stop');
    const demo = agent({ status: 'done', localId: undefined, cwd: '~/wt/x' });
    expect(ids(demo)).toEqual(['view', 'resume', 'continue', 'fork']);
  });
});
