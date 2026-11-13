import { describe, expect, it } from 'vitest';
import { answersAsText, applyClaudeEvent, flattenAnswers, newSession, parseStreamLine, replayTranscript, type ClaudeEvent } from './claude';

const S = 'sess-1';
const at = '2026-11-13T10:00:00.000Z';
const base = () => newSession({ localId: 'l1', cwd: 'C:/wt/x', title: 't', at });
const fold = (events: ClaudeEvent[]) => events.reduce(applyClaudeEvent, base());

const init: ClaudeEvent = { type: 'system', subtype: 'init', session_id: S, model: 'claude-opus-5-5', cwd: 'C:/wt/x' };
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };
const ask: ClaudeEvent = {
  type: 'assistant',
  session_id: S,
  message: {
    id: 'msg_2',
    content: [
      { type: 'text', text: 'One question first.' },
      { type: 'tool_use', id: 'toolu_q', name: 'AskUserQuestion', input: { questions: [{ question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Redis', description: 'fast' }, { label: 'Postgres' }] }] } },
    ],
    usage,
  },
};

describe('claude stream-json reducer', () => {
  it('tracks init, tool activity, usage and the end of a turn', () => {
    const s = fold([
      init,
      { type: 'assistant', session_id: S, message: { id: 'msg_1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts' } }], usage } },
      // same API message again (another content block): usage must not double
      { type: 'assistant', session_id: S, message: { id: 'msg_1', content: [{ type: 'text', text: 'Edited.' }], usage } },
    ]);
    expect(s).toMatchObject({ sessionId: S, model: 'claude-opus-5-5', status: 'running', lastText: 'Edited.' });
    expect(s.usage).toMatchObject({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 1000, contextTokens: 1060 });
    const mid = applyClaudeEvent(fold([init, { type: 'assistant', session_id: S, message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts' } }] } }]), { type: 'system', subtype: 'status', session_id: S });
    expect(mid.activity).toBe('Editing src/a.ts');

    const done = applyClaudeEvent(s, { type: 'result', subtype: 'success', is_error: false, session_id: S, result: 'All done', total_cost_usd: 0.25, duration_ms: 1200, num_turns: 3 });
    expect(done).toMatchObject({ status: 'idle', lastText: 'All done', activity: undefined });
    expect(done.usage).toMatchObject({ costUsd: 0.25, turns: 1, lastTurnMs: 1200 });
    expect(done.messages.find((m) => m.id === 't1')).toMatchObject({ status: 'ok' });
    // total_cost_usd is cumulative per process: the second turn adds the difference
    const two = applyClaudeEvent(done, { type: 'result', subtype: 'success', is_error: false, session_id: S, total_cost_usd: 0.4 });
    expect(two.usage.costUsd).toBeCloseTo(0.4);
    expect(two.usage.turns).toBe(2);
  });

  it('parks on AskUserQuestion and continues after the tool result', () => {
    const waiting = fold([init, ask]);
    expect(waiting.status).toBe('waiting');
    expect(waiting.activity).toBe('Has a question for you');
    expect(waiting.pendingQuestion).toEqual({ toolUseId: 'toolu_q', questions: [{ question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Redis', description: 'fast' }, { label: 'Postgres', description: undefined }] }] });
    // the CLI's permission request for AskUserQuestion does not add a permission prompt
    const asked = applyClaudeEvent(waiting, { type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: {}, tool_use_id: 'toolu_q' } });
    expect(asked.pendingPermissions).toEqual([]);

    const answered = applyClaudeEvent(asked, {
      type: 'user',
      session_id: S,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_q', content: 'User has answered your questions: "Which store?"="Redis". You can now continue.' }] },
    });
    expect(answered.status).toBe('running');
    expect(answered.pendingQuestion).toBeUndefined();
    expect(answered.messages.find((m) => m.id === 'toolu_q')).toMatchObject({ status: 'ok', answers: { 'Which store?': 'Redis' } });
  });

  it('turns other can_use_tool requests into permission prompts', () => {
    const s = fold([
      init,
      { type: 'assistant', session_id: S, message: { content: [{ type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'rm -rf build' } }] } },
      { type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tb' } },
    ]);
    expect(s.status).toBe('waiting');
    expect(s.activity).toBe('Wants to use Bash');
    expect(s.pendingPermissions).toEqual([{ requestId: 'r2', toolName: 'Bash', toolUseId: 'tb', input: { command: 'rm -rf build' }, reason: undefined }]);
    const after = applyClaudeEvent(s, { type: 'user', session_id: S, message: { content: [{ type: 'tool_result', tool_use_id: 'tb', content: 'denied', is_error: true }] } });
    expect(after.pendingPermissions).toEqual([]);
    expect(after.status).toBe('running');
    expect(after.messages.find((m) => m.id === 'tb')).toMatchObject({ status: 'error', detail: 'denied' });
  });

  it('marks failed turns, ignores subagent and unknown events', () => {
    const s = fold([init, { type: 'assistant', session_id: S, parent_tool_use_id: 'task1', message: { content: [{ type: 'text', text: 'sub' }] } }, { type: 'rate_limit_event' } as unknown as ClaudeEvent]);
    expect(s.messages).toEqual([]);
    const f = applyClaudeEvent(s, { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: S });
    expect(f).toMatchObject({ status: 'failed', error: 'error_during_execution' });
  });

  it('replays stored transcripts (user prompts as strings) to done', () => {
    const s = replayTranscript(base(), [{ type: 'user', session_id: S, message: { role: 'user', content: 'hello' } }, { type: 'assistant', session_id: S, message: { content: [{ type: 'text', text: 'hi' }] } }], false);
    expect(s.messages.map((m) => (m.role === 'tool' ? m.tool : m.text))).toEqual(['hello', 'hi']);
    expect(s.status).toBe('done');
  });

  it('parses lines and formats answers', () => {
    expect(parseStreamLine('{"type":"system","subtype":"init"}')).toMatchObject({ type: 'system' });
    expect(parseStreamLine('warning: something')).toBeNull();
    expect(parseStreamLine('{broken')).toBeNull();
    expect(flattenAnswers({ a: ['x', 'y'], b: 'z' })).toEqual({ a: 'x, y', b: 'z' });
    expect(answersAsText({ 'Which?': 'Redis' })).toBe('My answers to your questions:\n- Which? → Redis');
  });
});
