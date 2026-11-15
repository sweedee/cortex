import { describe, expect, it } from 'vitest';
import type { Item, ItemOf } from '../../domain';
import { buildPrRequest, defaultPrBody, defaultPrTitle, isInside, launchDisabled, liveInWorktree, prBase, removeDisabled, stackCandidates, statusLetter, testsDisabled } from './model';
import { isAbsolutePath } from '../../../../shared/paths';

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

describe('processes in a worktree', () => {
  it('finds agent sessions, running apps and test runs inside the folder (case / slash insensitive on Windows)', () => {
    const mk = (kind: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: kind + Math.random(), kind, handle: 'h', title: 't', createdAt: 0, updatedAt: 0, data, ...extra }) as unknown as Item;
    const dir = String.raw`C:\wt\x`;
    const items = [
      mk('agent', { localId: 'a1', cwd: 'c:/WT/x', status: 'done' }),
      mk('agent', { localId: 'a2', cwd: 'C:/wt/x-other', status: 'running' }),
      mk('agent', { cwd: dir, status: 'running' }),
      mk('app', { procId: 'p1', cwd: String.raw`C:\wt\x\web`, state: 'running', command: 'x' }),
      mk('app', { procId: 'p2', cwd: dir, state: 'stopped', command: 'x' }),
      mk('testrun', { procId: 't1', cwd: dir, state: 'running', command: 'x' }),
      mk('testrun', { procId: 't2', cwd: dir, state: 'running', command: 'x' }, { archived: true }),
    ];
    expect(liveInWorktree(items, dir)).toEqual({ agents: ['a1'], apps: ['p1'], tests: ['t1'] });
    expect(isInside(dir, 'C:/wt/x/')).toBe(true);
    expect(isInside(undefined, 'C:/wt/x')).toBe(false);
  });
});
