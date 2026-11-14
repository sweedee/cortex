import { describe, expect, it } from 'vitest';
import type { ItemOf } from '../../domain';
import { buildPrRequest, defaultPrBody, defaultPrTitle, isAbsolutePath, launchDisabled, prBase, removeDisabled, stackCandidates, statusLetter, testsDisabled } from './model';

const base = { createdAt: 0, updatedAt: 0 };
const wt = (over: Partial<ItemOf<'worktree'>['data']> = {}): ItemOf<'worktree'> => ({
  ...base,
  id: 'w1',
  kind: 'worktree',
  handle: 'wt/x',
  title: 'x',
  data: { path: 'C:\\wt\\x', branch: 'feat/CTX-12-retry-backoff', baseBranch: 'main', ticketKey: 'CTX-12', ...over },
});
const project = (over: Partial<ItemOf<'project'>['data']> = {}): ItemOf<'project'> => ({
  ...base,
  id: 'p1',
  kind: 'project',
  handle: 'p',
  title: 'p',
  data: { repo: 'o/r', defaultBranch: 'main', baseDir: '/repo', startCommand: 'npm run dev', testCommand: 'npm test', ...over },
});
const pr = (id: string, head: string, state: 'open' | 'merged' = 'open'): ItemOf<'pr'> => ({
  ...base,
  id,
  kind: 'pr',
  handle: id,
  title: id,
  data: { repo: 'o/r', number: 1, headBranch: head, baseBranch: 'main', state, isDraft: false },
});

describe('worktree model', () => {
  it('detects absolute paths', () => {
    expect(['C:\\a', 'C:/a', '/a', '\\\\srv\\a'].every(isAbsolutePath)).toBe(true);
    expect(['~/wt/a', 'wt/a', '', undefined].some(isAbsolutePath)).toBe(false);
  });
  it('maps status letters', () => {
    expect(statusLetter({ kind: 'untracked', index: '?', worktree: '?' })).toBe('?');
    expect(statusLetter({ kind: 'changed', index: '.', worktree: 'M' })).toBe('M');
    expect(statusLetter({ kind: 'changed', index: 'A', worktree: '.' })).toBe('A');
    expect(statusLetter({ kind: 'unmerged', index: 'U', worktree: 'U' })).toBe('U');
  });
  it('defaults the PR title and body', () => {
    expect(defaultPrTitle(wt())).toBe('CTX-12: Retry backoff');
    const url = (k: string) => `https://acme.atlassian.net/browse/${k}`;
    expect(defaultPrBody(wt(), undefined, url)).toBe('Ticket: [CTX-12](https://acme.atlassian.net/browse/CTX-12)\n\n');
    expect(defaultPrBody(wt({ ticketKey: undefined }), undefined, url)).toBe('');
  });
  it('stacks on the parent PR head branch', () => {
    const prs = [pr('a', 'feat/a'), pr('b', 'feat/b', 'merged'), pr('own', 'feat/CTX-12-retry-backoff')];
    expect(stackCandidates(prs, wt()).map((p) => p.id)).toEqual(['a']);
    const v = { title: ' T ', body: 'B', base: 'main', draft: true, stackOn: 'a' };
    expect(prBase(v, prs)).toBe('feat/a');
    expect(buildPrRequest(wt(), project(), v, prs)).toEqual({ dir: 'C:\\wt\\x', repo: 'o/r', title: 'T', body: 'B', base: 'feat/a', head: 'feat/CTX-12-retry-backoff', draft: true });
    expect(buildPrRequest(wt(), project(), { ...v, stackOn: '', draft: false }, prs).base).toBe('main');
  });
  it('explains disabled actions', () => {
    expect(launchDisabled(wt({ path: '~/wt/x' }), project())).toMatch(/demo/);
    expect(launchDisabled(wt(), project({ startCommand: undefined }))).toMatch(/start command/);
    expect(launchDisabled(wt(), project())).toBeUndefined();
    expect(testsDisabled(wt(), project({ testCommand: undefined }))).toMatch(/test command/);
    expect(removeDisabled(wt(), project({ baseDir: undefined }))).toMatch(/base checkout/);
    expect(removeDisabled(wt({ path: '~/wt/x' }), undefined)).toBeUndefined();
  });
});
