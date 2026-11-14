import { describe, expect, it } from 'vitest';
import type { Item, ItemOf } from '../../domain';
import { nextSteps } from './index';
import { branchFolder, countSteps, normPath, planDiscovery, recordTypeOf, sameBranch } from './model';

const base = { createdAt: 0, updatedAt: 0 };
const project: ItemOf<'project'> = { ...base, id: 'p', kind: 'project', handle: 'p', title: 'p', data: { repo: 'o/r', defaultBranch: 'main', baseDir: 'C:\\code\\r' } };
const ticket: ItemOf<'ticket'> = {
  ...base,
  id: 't',
  kind: 'ticket',
  handle: 'CTX-1',
  title: 'T',
  data: { key: 'CTX-1', status: 'Open', statusCategory: 'new', type: 'Story', branch: 'feat/CTX-1-x' },
};
const worktree: ItemOf<'worktree'> = { ...base, id: 'w', kind: 'worktree', handle: 'wt/x', title: 'x', projectId: 'p', data: { path: 'C:\\wt\\x', branch: 'feat/CTX-1-x', baseBranch: 'main' } };
const record = (path: string, type: ItemOf<'record'>['data']['recordType'] = 'plan'): ItemOf<'record'> => ({
  ...base,
  id: 'r',
  kind: 'record',
  handle: 'plan.md',
  title: 'plan.md',
  data: { recordType: type, path, status: 'draft' },
});

describe('record model', () => {
  it('derives the type from the file name', () => {
    expect(recordTypeOf('plan.md')).toBe('plan');
    expect(recordTypeOf('feat/x/PLAN-CTX-1.md')).toBe('plan');
    expect(recordTypeOf('Brainstorm_notes.md')).toBe('brainstorm');
    expect(recordTypeOf('grill.md')).toBe('grill');
    expect(recordTypeOf('verification-2.md')).toBe('verification');
    expect(recordTypeOf('notes.md')).toBeUndefined();
    expect(recordTypeOf('plan.txt')).toBeUndefined();
  });
  it('counts task steps outside code fences', () => {
    expect(countSteps('- [x] a\n- [ ] b\n```\n- [ ] c\n```\n1. [X] d\nno')).toEqual({ done: 2, total: 3 });
  });
  it('splits the branch folder and compares paths', () => {
    expect(branchFolder('feat/CTX-1-x/plan.md')).toBe('feat/CTX-1-x');
    expect(branchFolder('plan.md')).toBeUndefined();
    expect(sameBranch('feat/CTX-1-x', 'feat-CTX-1-x')).toBe(true);
    expect(normPath('C:\\A\\b\\')).toBe(normPath('c:/a/b'));
  });
  it('plans new records with links to the ticket and worktree', () => {
    const files = [
      { path: 'C:\\code\\r\\records\\feat\\CTX-1-x\\plan.md', name: 'feat/CTX-1-x/plan.md', text: '- [x] a\n- [ ] b' },
      { path: 'C:\\code\\r\\records\\feat\\CTX-1-x\\readme.md', name: 'feat/CTX-1-x/readme.md' },
    ];
    const plan = planDiscovery([project, ticket, worktree], project, files);
    expect(plan.add).toHaveLength(1);
    const { item, links } = plan.add[0];
    expect(item).toMatchObject({ kind: 'record', handle: 'plan.md', projectId: 'p', data: { recordType: 'plan', ticketBranch: 'feat/CTX-1-x', ticketKey: 'CTX-1', status: 'draft', steps: { done: 1, total: 2 } } });
    expect(links.map((l) => l.to).sort()).toEqual(['t', 'w']);
  });
  it('does not duplicate: existing records (any path spelling) are only updated', () => {
    const existing = record('c:/code/r/records/feat/CTX-1-x/plan.md');
    const items: Item[] = [project, ticket, existing];
    const files = [{ path: 'C:\\code\\r\\records\\feat\\CTX-1-x\\plan.md', name: 'feat/CTX-1-x/plan.md', text: '- [x] a' }];
    const plan = planDiscovery(items, project, files);
    expect(plan.add).toEqual([]);
    expect(plan.update).toEqual([{ id: 'r', patch: { steps: { done: 1, total: 1 }, ticketBranch: 'feat/CTX-1-x', ticketKey: 'CTX-1' } }]);
    expect(plan.links).toEqual([{ from: 'r', to: 't', label: 'plan for' }]);
    expect(planDiscovery(items, project, files).add).toEqual([]);
  });
  it('offers the next workflow step', () => {
    const ids = (t: ItemOf<'record'>['data']['recordType']) => nextSteps(record('/x/a.md', t)).map((a) => a.skill);
    expect(ids('plan')).toEqual(['grill']);
    expect(ids('brainstorm')).toEqual(['plan']);
    expect(ids('grill')).toEqual(['implement']);
    expect(ids('verification')).toEqual([]);
  });
});
