import { describe, expect, it } from 'vitest';
import type { ClaudeEvent } from '../../../../shared/integrations/claude';
import type { ItemOf } from '../../domain';
import { makeItem } from '../../store';
import { agentActions } from './actions';
import { answersOf, buildRows, buildTranscript, contextTone, emptyChoice, groupRows, inputText, isAnswered, toggleChoice, toggleOther, tokens, transcriptBuilder, usd } from './transcript';

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

describe('incremental transcript', () => {
  const delta = (text: string) => ev({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
  const sub = (content: unknown[], id: string) => ev({ type: 'assistant', parent_tool_use_id: 'task1', message: { id, content } });
  const subUser = (content: unknown) => ev({ type: 'user', parent_tool_use_id: 'task1', message: { role: 'user', content } });
  const stream: ClaudeEvent[] = [
    ev({ type: 'system', subtype: 'init', model: 'claude-x' }),
    user('map the code'),
    delta('Let '),
    delta('me '),
    delta('look.'),
    asst([{ type: 'thinking', thinking: 'Delegate it.' }, { type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'task1', name: 'Task', input: { description: 'Explore', prompt: 'find the router', subagent_type: 'Explore' } }]),
    ev({ type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'task1', description: 'Explore', subagent_type: 'Explore' }),
    sub([{ type: 'text', text: 'Searching.' }, { type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'router' } }], 's1'),
    subUser([{ type: 'tool_result', tool_use_id: 'g1', content: 'src/router.ts' }]),
    sub([{ type: 'tool_use', id: 'task2', name: 'Agent', input: { description: 'Nested', prompt: 'deeper' } }], 's2'),
    ev({ type: 'system', subtype: 'task_progress', task_id: 'a1', tool_use_id: 'task1', description: 'reading', usage: { tool_uses: 2, total_tokens: 900 } }),
    user([{ type: 'tool_result', tool_use_id: 'task1', content: 'It is in src/router.ts' }]),
    delta('Found '),
    delta('it.'),
    asst([{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/src/router.ts' } }, { type: 'tool_use', id: 'r2', name: 'Bash', input: { command: 'ls' } }], 'm2'),
    user([{ type: 'tool_result', tool_use_id: 'r1', content: 'export …' }]),
    asst([{ type: 'text', text: 'Done.' }], 'm3'),
    ev({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', duration_ms: 10 }),
  ];

  it('equals a full rebuild after every event and for any chunking', () => {
    const b = transcriptBuilder('x');
    for (let i = 1; i <= stream.length; i++) expect(b.update(stream.slice(0, i))).toEqual(buildTranscript(stream.slice(0, i), 'x'));
    for (const size of [2, 3, 5, 7]) {
      const c = transcriptBuilder('x');
      for (let i = size; i < stream.length + size; i += size) c.update(stream.slice(0, i));
      expect(c.update(stream)).toEqual(buildTranscript(stream, 'x'));
    }
    const rows = buildRows(stream, 'x');
    expect(rows.map((r) => r.kind)).toEqual(['user', 'assistant', 'thinking', 'subagent', 'assistant', 'tool', 'tool', 'assistant']) // the streamed draft is already there when thinking arrives;
    expect(rows[3]).toMatchObject({ kind: 'subagent', prompt: 'find the router', result: 'It is in src/router.ts', children: [{ kind: 'assistant', text: 'Searching.' }, { kind: 'tool', tool: 'Grep', status: 'ok' }, { kind: 'subagent', tool: 'Agent', prompt: 'deeper' }] });
  });

  it('keeps unchanged rows (and the result when nothing changed) by identity', () => {
    const b = transcriptBuilder('x');
    const upTo = (n: number) => stream.slice(0, n);
    const before = b.update(upTo(12)).rows;
    expect(b.update(upTo(12))).toBe(b.update(upTo(12)));
    const streaming = b.update(upTo(13)).rows; // the first "Found " delta
    expect(streaming.slice(0, before.length)).toEqual(before);
    streaming.slice(0, before.length).forEach((r, i) => expect(r).toBe(before[i]));
    const next = b.update(upTo(14)).rows; // more text: only the draft row changes
    next.slice(0, -1).forEach((r, i) => expect(r).toBe(streaming[i]));
    expect(next.at(-1)).not.toBe(streaming.at(-1));
    expect(next.at(-1)).toMatchObject({ kind: 'assistant', text: 'Found it.' });
  });

  it('rebuilds a subagent row when its children change, and starts over on a non-append', () => {
    const b = transcriptBuilder('x');
    const r8 = b.update(stream.slice(0, 8)).rows.find((r) => r.kind === 'subagent');
    const r9 = b.update(stream.slice(0, 9)).rows.find((r) => r.kind === 'subagent');
    expect(r9).not.toBe(r8);
    expect(r9 && r9.kind === 'subagent' && r9.children[0]).toBe(r8 && r8.kind === 'subagent' && r8.children[0]);
    const other = [user('something else')];
    expect(b.update(other)).toEqual(buildTranscript(other, 'x'));
    expect(b.update(stream)).toEqual(buildTranscript(stream, 'x'));
    expect(b.update([...stream.slice(0, 3), user('edited')])).toEqual(buildTranscript([...stream.slice(0, 3), user('edited')], 'x'));
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
