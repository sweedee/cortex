import { describe, expect, it } from 'vitest';
import type { ClaudeEvent } from '../../../shared/integrations/claude';
import { queryClient } from '../data/queryClient';
import { qk } from '../data/queryKeys';
import type { Item } from '../domain';
import { evictTranscripts, flushClaudeEvents, queueClaudeEvent } from '../kinds/agent/live';

const ev = (n: number) => ({ type: 'system', subtype: 'status', n }) as unknown as ClaudeEvent;
const agent = (localId: string, archived?: boolean) => ({ id: `i-${localId}`, kind: 'agent', title: localId, archived, data: { cwd: '', status: 'idle', localId } }) as unknown as Item;

describe('claude:event batching', () => {
  it('appends queued events in one update per flush, only to loaded transcripts', () => {
    const key = qk.claude.transcript('b1');
    const start = [ev(0)];
    queryClient.setQueryData(key, start);
    queueClaudeEvent('b1', ev(1));
    queueClaudeEvent('b1', ev(2));
    queueClaudeEvent('b2', ev(3)); // not loaded: dropped, like before
    expect(queryClient.getQueryData(key)).toBe(start);
    flushClaudeEvents();
    const after = queryClient.getQueryData<ClaudeEvent[]>(key)!;
    expect(after.map((e) => (e as unknown as { n: number }).n)).toEqual([0, 1, 2]);
    expect(after[0]).toBe(start[0]);
    expect(queryClient.getQueryData(qk.claude.transcript('b2'))).toBeUndefined();
    flushClaudeEvents();
    expect(queryClient.getQueryData(key)).toBe(after);
  });
});

describe('transcript eviction', () => {
  it('drops the cache of removed and archived agents, keeps the others', () => {
    for (const id of ['e1', 'e2', 'e3']) queryClient.setQueryData(qk.claude.transcript(id), [ev(0)]);
    const prev = [agent('e1'), agent('e2'), agent('e3')];
    evictTranscripts([agent('e1'), agent('e3', true)], prev);
    expect(queryClient.getQueryData(qk.claude.transcript('e1'))).toBeDefined();
    expect(queryClient.getQueryData(qk.claude.transcript('e2'))).toBeUndefined();
    expect(queryClient.getQueryData(qk.claude.transcript('e3'))).toBeUndefined();
  });
});
