import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_USAGE, parseStreamLine, type ClaudeEvent, type SubagentInfo } from '../../../../shared/integrations/claude';
import { mapClaudeState } from '../../sync/mapping';
import { buildTranscript, groupRows } from './transcript';
import { duration, subagentTally, tokens, usageView } from './usage';
import { must } from '../../testing/must';

describe('status bar numbers', () => {
  it('context meter, cache hit rates, window guess', () => {
    const v = usageView({ ...NO_USAGE, contextTokens: 170_000, inputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 90, outputTokens: 50, last: { input: 2, cacheRead: 160_000, cacheWrite: 9_998, output: 5 }, turns: 2, durationMs: 65_000 });
    expect(v).toMatchObject({ contextWindow: 200_000, windowGuessed: true, contextPct: 85, tone: 'warning', lastHitPct: 94, totalHitPct: 90, durationMs: 65_000 });
    expect(usageView({ ...NO_USAGE, contextTokens: 170_000, contextWindow: 1_000_000 })).toMatchObject({ contextPct: 17, tone: 'normal', windowGuessed: false, lastHitPct: undefined, totalHitPct: undefined });
    expect(usageView({ ...NO_USAGE, contextTokens: 199_000 }).tone).toBe('critical');
  });

  it('formats', () => {
    expect([tokens(999), tokens(1_250), tokens(84_000), tokens(1_000_000)]).toEqual(['999', '1.3k', '84k', '1M']);
    expect([duration(3_400), duration(125_000), duration(4_000_000)]).toEqual(['3.4s', '2m 5s', '1h 6m']);
  });

  it('tallies subagents', () => {
    const sub = (status: SubagentInfo['status']): SubagentInfo => ({ toolUseId: status, description: status, status, startedAt: '', toolUses: 0 });
    expect(subagentTally([sub('running'), sub('done'), sub('done'), sub('failed')])).toMatchObject({ running: 1, done: 2, failed: 1, total: 4, text: '1 running · 2 done · 1 failed' });
    expect(subagentTally([]).text).toBe('');
  });
});

describe('transcript with a subagent (real Claude Code session)', () => {
  const events = readFileSync(join(__dirname, '../../../../shared/integrations/__fixtures__/claude-real-subagent.jsonl'), 'utf8')
    .split('\n')
    .map(parseStreamLine)
    .filter((e): e is ClaudeEvent => !!e);

  it('nests the subagent’s tool calls under its Agent call', () => {
    const { rows, subagents } = buildTranscript(events, 'x');
    expect(subagents).toHaveLength(1);
    expect(rows.map((r) => r.kind)).toEqual(['subagent', 'assistant', 'note', 'assistant']);
    const sub = must(rows[0]);
    if (sub.kind !== 'subagent') throw new Error('expected a subagent row');
    expect(sub).toMatchObject({ tool: 'Agent', status: 'ok', sub: { description: 'List files', status: 'done' } });
    expect(sub.prompt).toMatch(/Glob tool/);
    expect(sub.children.map((c) => (c.kind === 'tool' ? c.tool : c.kind))).toEqual(['Glob', 'SubagentHandback']);
    // the nested calls are grouped like top-level ones
    expect(groupRows(sub.children)).toHaveLength(1);
  });

  it('the canvas item gets the context, window and subagent tally', () => {
    const { subagents } = buildTranscript(events);
    const { patch } = mapClaudeState(
      { localId: 'x', cwd: '/tmp', title: 't', status: 'idle', pendingPermissions: [], subagents, running: true, createdAt: '', updatedAt: '', effort: 'high', permissionMode: 'plan', usage: { ...NO_USAGE, contextTokens: 50_000, contextWindow: 1_000_000 } },
      { cwd: '/tmp', status: 'running' },
      't',
    );
    expect(patch).toMatchObject({ usage: { contextPct: 5, contextTokens: 50_000, contextWindow: 1_000_000 }, effort: 'high', permissionMode: 'plan', subagents: { running: 0, total: 1 } });
  });
});
