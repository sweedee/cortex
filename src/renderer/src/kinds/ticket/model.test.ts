import { describe, expect, it } from 'vitest';
import { jiraBrowseUrl as jiraUrl } from '../../../../shared/integrations/jira';
import { linkRows, relatedIds, stepsToDone, transitionToDone } from './model';

describe('ticket model', () => {
  it('walks the workflow to Done', () => {
    expect(stepsToDone('To Do')).toEqual(['In Progress', 'In Review', 'Done']);
    expect(stepsToDone('in review')).toEqual(['Done']);
    expect(stepsToDone('Blocked')).toEqual(['In Progress', 'In Review', 'Done']);
    expect(stepsToDone('Done')).toEqual([]);
    expect(stepsToDone('Weird')).toEqual(['Done']);
  });

  it('builds browse urls', () => {
    expect(jiraUrl('CTX-1')).toBe('https://example.atlassian.net/browse/CTX-1');
    expect(jiraUrl('CTX-1', { site: 'https://acme.atlassian.net/' })).toBe('https://acme.atlassian.net/browse/CTX-1');
    expect(jiraUrl('CTX-1', { issue: { key: 'CTX-1', self: 'https://x.atlassian.net/rest/api/3/issue/10001' }, site: 'https://other' })).toBe('https://x.atlassian.net/browse/CTX-1');
  });

  it('marks done directly, then step by step, then reports the error', async () => {
    const calls: string[] = [];
    const direct = await transitionToDone('K-1', 'In Review', async (_k, s) => void calls.push(s));
    expect(direct).toEqual({ ok: true, via: 'direct' });
    expect(calls).toEqual(['Done']);

    const log: string[] = [];
    const strict = async (_k: string, s: string) => {
      log.push(s);
      if (s === 'Done' && log.length === 1) throw new Error('transition to "Done" is not available');
    };
    expect(await transitionToDone('K-1', 'To Do', strict)).toEqual({ ok: true, via: 'steps' });
    expect(log).toEqual(['Done', 'In Progress', 'In Review', 'Done']);

    const never = async () => {
      throw new Error('nope');
    };
    expect(await transitionToDone('K-1', 'To Do', never)).toEqual({ ok: false, error: 'nope' });
    expect(await transitionToDone('K-1', 'In Review', never)).toEqual({ ok: false, error: 'nope' });
  });

  it('lists issue links', () => {
    const rows = linkRows({
      issuelinks: [
        { id: '1', type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: { key: 'CTX-2', fields: { summary: 'Other', status: { name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } } } } },
        { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'CTX-3', fields: { summary: 'Third' } } },
      ],
    });
    expect(rows.map((r) => `${r.relation} ${r.key}`)).toEqual(['blocks CTX-2', 'is blocked by CTX-3']);
    expect(rows[0].status).toBe('To Do');
    expect(linkRows({})).toEqual([]);
  });

  it('finds related canvas items including PRs of worktrees', () => {
    const kinds: Record<string, string> = { t: 'ticket', w: 'worktree', pr: 'pr', r: 'record', p: 'project' };
    const links = [
      { from: 'w', to: 't' },
      { from: 'r', to: 't' },
      { from: 'pr', to: 'w' },
      { from: 't', to: 'p' },
    ];
    expect(relatedIds(links, 't', (id) => kinds[id]).sort()).toEqual(['pr', 'r', 'w']);
  });
});
