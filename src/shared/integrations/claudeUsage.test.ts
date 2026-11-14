/** Usage, context window, subagents and control responses in the stream-json reducer. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyClaudeEvent, catalogOf, localCommandOutput, newSession, parseStreamLine, toSummary, type ClaudeEvent } from './claude';

const S = 'sess-1';
const base = () => newSession({ localId: 'l1', cwd: '/tmp/demo', title: 't', at: '2026-11-14T10:00:00.000Z' });
const fold = (events: ClaudeEvent[]) => events.reduce(applyClaudeEvent, base());
const init: ClaudeEvent = { type: 'system', subtype: 'init', session_id: S, model: 'claude-opus-5-5' };
const u = (input: number, output: number, read: number, write: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write });
const say = (id: string, usage: ReturnType<typeof u>, content: unknown[] = [{ type: 'text', text: 'x' }], parent: string | null = null): ClaudeEvent =>
  ({ type: 'assistant', session_id: S, parent_tool_use_id: parent, message: { id, model: 'claude-opus-5-5', content, usage } }) as ClaudeEvent;

describe('usage', () => {
  it('sums each API message once, keeps the latest main-thread call as the context', () => {
    const s = fold([init, say('m1', u(5, 10, 1000, 200)), say('m1', u(5, 10, 1000, 200)), say('m2', u(3, 7, 1200, 50))]);
    expect(s.usage).toMatchObject({ inputTokens: 8, outputTokens: 17, cacheReadTokens: 2200, cacheWriteTokens: 250, contextTokens: 1253, last: { input: 3, cacheRead: 1200, cacheWrite: 50, output: 7 } });
  });

  it('subagent calls count in the totals but not in the context', () => {
    const s = fold([init, say('m1', u(5, 10, 1000, 200)), say('sub1', u(2, 4, 9000, 900), [{ type: 'text', text: 'sub' }], 'toolu_task')]);
    expect(s.usage.contextTokens).toBe(1205);
    expect(s.usage.cacheReadTokens).toBe(10_000);
  });

  it('the result sets the window, the turn totals (incl. subagents), cost, turns and duration', () => {
    const s = fold([init, say('m1', u(5, 10, 1000, 200))]);
    const r = applyClaudeEvent(s, {
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: S,
      total_cost_usd: 0.5,
      duration_ms: 4000,
      model_usage_since_last_result: { 'claude-opus-5-5': { inputTokens: 9, outputTokens: 30, cacheReadInputTokens: 5000, cacheCreationInputTokens: 300, contextWindow: 1_000_000 } },
      modelUsage: { 'claude-opus-5-5': { inputTokens: 9, outputTokens: 30, cacheReadInputTokens: 5000, cacheCreationInputTokens: 300, contextWindow: 1_000_000 } },
    });
    expect(r.usage).toMatchObject({ inputTokens: 9, outputTokens: 30, cacheReadTokens: 5000, cacheWriteTokens: 300, contextWindow: 1_000_000, costUsd: 0.5, turns: 1, durationMs: 4000, turnBase: undefined });
    // the next turn starts from there
    const t2 = applyClaudeEvent(r, say('m2', u(1, 2, 3, 4)));
    expect(t2.usage).toMatchObject({ inputTokens: 10, turnBase: { inputTokens: 9, outputTokens: 30, cacheReadTokens: 5000, cacheWriteTokens: 300 } });
  });

  it('without per-turn numbers the summed ones stay', () => {
    const r = applyClaudeEvent(fold([init, say('m1', u(5, 10, 1000, 200))]), { type: 'result', subtype: 'success', is_error: false, session_id: S });
    expect(r.usage).toMatchObject({ inputTokens: 5, outputTokens: 10, contextWindow: undefined, turns: 1 });
  });
});

describe('subagents', () => {
  const task = say('m1', u(1, 1, 1, 1), [{ type: 'tool_use', id: 'toolu_task', name: 'Agent', input: { description: 'Map the code', subagent_type: 'Explore', prompt: 'look around' } }]);
  it('a Task / Agent tool use starts one; its tool calls nest under it; its result ends it', () => {
    const s = fold([
      init,
      task,
      { type: 'system', subtype: 'task_started', session_id: S, task_id: 'a1', tool_use_id: 'toolu_task', description: 'Map the code', subagent_type: 'Explore' },
      { type: 'user', session_id: S, parent_tool_use_id: 'toolu_task', message: { role: 'user', content: 'look around' } },
      say('sub1', u(1, 1, 1, 1), [{ type: 'tool_use', id: 'toolu_g', name: 'Grep', input: { pattern: 'TODO' } }], 'toolu_task'),
    ]);
    expect(s.subagents).toMatchObject([{ toolUseId: 'toolu_task', taskId: 'a1', description: 'Map the code', type: 'Explore', status: 'running', toolUses: 1, lastTool: 'Grep' }]);
    expect(s.messages.map((m) => [m.id, m.parent])).toEqual([
      ['toolu_task', undefined],
      ['toolu_g', 'toolu_task'],
    ]);
    expect(s.activity).toBe('Map the code › Searching for TODO');
    const p = applyClaudeEvent(s, { type: 'system', subtype: 'task_progress', session_id: S, task_id: 'a1', tool_use_id: 'toolu_task', description: 'Reading a.ts', usage: { total_tokens: 1234, tool_uses: 3, duration_ms: 900 }, last_tool_name: 'Read' });
    expect(p.subagents[0]).toMatchObject({ toolUses: 3, tokens: 1234, durationMs: 900, lastTool: 'Read', activity: 'Reading a.ts' });
    const done = (
      [
        { type: 'user', session_id: S, parent_tool_use_id: 'toolu_task', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_g', content: 'a.ts:1' }] } },
        { type: 'user', session_id: S, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'found 3' }] } },
      ] as ClaudeEvent[]
    ).reduce(applyClaudeEvent, p);
    expect(done.subagents[0]).toMatchObject({ status: 'done', activity: undefined });
    expect(done.messages.find((m) => m.id === 'toolu_g')).toMatchObject({ status: 'ok', detail: 'a.ts:1' });
    // the subagent's prompt is not a user message of the session
    expect(done.messages.some((m) => m.role === 'user')).toBe(false);
  });

  it('ends with the tool result (foreground) or the task events (background); a failed turn stops the rest', () => {
    const started = fold([init, task]);
    const ok = applyClaudeEvent(started, { type: 'user', session_id: S, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'found 3' }] } });
    expect(ok.subagents[0]).toMatchObject({ status: 'done' });
    const bg = fold([init, say('m1', u(1, 1, 1, 1), [{ type: 'tool_use', id: 'toolu_bg', name: 'Task', input: { description: 'Watch CI', run_in_background: true } }])]);
    const launched = applyClaudeEvent(bg, { type: 'user', session_id: S, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bg', content: 'launched' }] } });
    expect(launched.subagents[0]).toMatchObject({ status: 'running', background: true });
    const fin = applyClaudeEvent(launched, { type: 'system', subtype: 'task_notification', session_id: S, tool_use_id: 'toolu_bg', status: 'failed', usage: { total_tokens: 50, tool_uses: 1 } });
    expect(fin.subagents[0]).toMatchObject({ status: 'failed', tokens: 50 });
    const killed = applyClaudeEvent(started, { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: S });
    expect(killed.subagents[0].status).toBe('stopped');
    // summaries carry them
    expect(toSummary(killed).subagents).toHaveLength(1);
  });
});

describe('control responses and notes', () => {
  it('initialize → commands / models (session only, not the summary); set_model / set_permission_mode → the session', () => {
    const s = fold([
      init,
      { type: 'control_response', response: { subtype: 'success', request_id: 'init-1', response: { commands: [{ name: 'review', description: 'Review', argumentHint: '<pr>' }, { bad: 1 }], models: [{ value: 'opus', displayName: 'Opus', supportedEffortLevels: ['low', 'max'] }], claude_code_version: '2.1.325' } } },
      { type: 'control_response', response: { subtype: 'success', request_id: 'sm-1', response: { model: 'claude-sonnet-5-5' } } },
      { type: 'control_response', response: { subtype: 'success', request_id: 'pm-1', response: { mode: 'plan' } } },
    ]);
    expect(s.commands).toEqual([{ name: 'review', description: 'Review', argumentHint: '<pr>' }]);
    expect(s.models).toEqual([{ value: 'opus', displayName: 'Opus', supportedEffortLevels: ['low', 'max'] }]);
    expect(s).toMatchObject({ model: 'claude-sonnet-5-5', permissionMode: 'plan', cliVersion: '2.1.325' });
    expect(toSummary(s)).not.toHaveProperty('commands');
    expect(catalogOf({ nothing: true })).toBeNull();
    const st = applyClaudeEvent(s, { type: 'system', subtype: 'status', session_id: S, permissionMode: 'acceptEdits' });
    expect(st.permissionMode).toBe('acceptEdits');
  });

  it('local command output becomes a note; other replays are skipped', () => {
    expect(localCommandOutput('<local-command-stdout>Set model to `sonnet`</local-command-stdout>')).toBe('Set model to sonnet');
    expect(localCommandOutput('hello')).toBeUndefined();
    const s = fold([
      { type: 'user', session_id: S, isReplay: true, message: { role: 'user', content: '<local-command-stdout>Set model to `sonnet (claude-sonnet-5-5)`</local-command-stdout>' } },
      { type: 'user', session_id: S, isReplay: true, message: { role: 'user', content: 'echoed' } },
    ]);
    expect(s.messages).toMatchObject([{ role: 'note', text: 'Set model to sonnet (claude-sonnet-5-5)' }]);
  });
});

describe('a real Claude Code 2.1.325 session (haiku, one subagent, then a live model / mode switch)', () => {
  const events = readFileSync(join(__dirname, '__fixtures__/claude-real-subagent.jsonl'), 'utf8')
    .split('\n')
    .map(parseStreamLine)
    .filter((e): e is ClaudeEvent => !!e);
  const firstResult = events.findIndex((e) => e.type === 'result');

  it('turn 1: subagent, usage, window, cost', () => {
    const s = events.slice(0, firstResult + 1).reduce(applyClaudeEvent, base());
    expect(s).toMatchObject({ model: 'claude-haiku-5-5', permissionMode: 'auto', status: 'idle', lastText: 'one.txt\ntwo.txt' });
    expect(s.subagents).toMatchObject([{ toolUseId: 'toolu_01GYgYGRSRjsVTdgZiasP1VK', taskId: 'a6ebe04f2dbc096b6', description: 'List files', type: 'general-purpose', status: 'done', toolUses: 2, tokens: 22339 }]);
    const nested = s.messages.filter((m) => m.parent === 'toolu_01GYgYGRSRjsVTdgZiasP1VK');
    expect(nested.map((m) => (m.role === 'tool' ? m.tool : m.role))).toEqual(['Glob', 'SubagentHandback']);
    expect(nested[0]).toMatchObject({ status: 'ok', detail: 'one.txt\ntwo.txt' });
    expect(s.messages.filter((m) => !m.parent).map((m) => (m.role === 'tool' ? m.tool : m.role))).toEqual(['Agent', 'assistant']);
    expect(s.usage).toMatchObject({ contextWindow: 1_000_000, contextTokens: 2 + 2796 + 25681, inputTokens: 8, outputTokens: 693, cacheReadTokens: 62096, cacheWriteTokens: 34935, turns: 1 });
    expect(s.usage.costUsd).toBeCloseTo(0.00629, 4);
    expect(s.commands?.map((c) => c.name)).toContain('compact');
    expect(s.models?.map((m) => m.value)).toEqual(expect.arrayContaining(['default', 'opus', 'sonnet', 'haiku']));
  });

  it('turn 2: set_model / set_permission_mode applied live, notes the switch', () => {
    const s = events.reduce(applyClaudeEvent, base());
    expect(s).toMatchObject({ model: 'claude-sonnet-5-5', permissionMode: 'plan', status: 'idle', lastText: 'ok' });
    expect(s.messages.filter((m) => m.role === 'note').map((m) => m.text)).toEqual(['Set model to sonnet (claude-sonnet-5-5)']);
    expect(s.usage).toMatchObject({ turns: 2, outputTokens: 697, cacheReadTokens: 62096 + 15732 });
    expect(s.usage.costUsd).toBeCloseTo(0.0674, 3);
  });
});
