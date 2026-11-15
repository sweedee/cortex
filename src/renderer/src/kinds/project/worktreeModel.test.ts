import { describe, expect, it } from 'vitest';
import { ticketKeyOf } from '../../../../shared/util';
import { samePath } from '../../../../shared/paths';
import { branchForTicket, defaultWorktreePath, slugify, untrackedWorktrees, worktreeAddArgs, worktreeHandle, worktreesDirFor } from './worktreeModel';

describe('worktree model', () => {
  it('slugifies and builds ticket branches', () => {
    expect(slugify('Retry with exponential backoff in the dispatcher!')).toBe('retry-with-exponential-backoff-in-the');
    expect(branchForTicket('CTX-4821', 'Retry: back-off')).toBe('CTX-4821-retry-back-off');
    expect(branchForTicket('CTX-1', '')).toBe('CTX-1');
    expect(ticketKeyOf('feat/CTX-4821-retry')).toBe('CTX-4821');
    expect(ticketKeyOf('main')).toBeUndefined();
  });

  it('defaults the path from the worktrees folder or the base checkout', () => {
    expect(defaultWorktreePath({ worktreesDir: 'C:\\wt\\app\\' }, 'CTX-1-x')).toBe('C:\\wt\\app\\CTX-1-x');
    expect(defaultWorktreePath({ worktreesDir: '/home/me/wt/app' }, 'feat/x')).toBe('/home/me/wt/app/feat/x');
    expect(defaultWorktreePath({ baseDir: '/home/me/code/app' }, 'x')).toBe('/home/me/code/wt/app/x');
    expect(defaultWorktreePath({}, 'x')).toBe('');
    expect(defaultWorktreePath({ worktreesDir: '/w' }, ' ')).toBe('');
  });

  it('uses the configured branch template (git.branchTemplate)', () => {
    expect(branchForTicket('CTX-4821', 'Retry: back-off', '{key}-{slug}')).toBe('CTX-4821-retry-back-off');
    expect(branchForTicket('CTX-4821', 'Retry: back-off', 'feat/{key}-{slug}')).toBe('feat/CTX-4821-retry-back-off');
    expect(branchForTicket('CTX-4821', 'Retry', 'sven/{key}')).toBe('sven/CTX-4821');
    expect(branchForTicket('CTX-1', '', 'feat/{key}-{slug}')).toBe('feat/CTX-1');
  });

  it('resolves the worktrees folder template (git.worktreesDir)', () => {
    expect(worktreesDirFor('C:\\code\\app')).toBe('C:\\code\\wt\\app');
    expect(worktreesDirFor('/home/me/code/app/', '../wt/{repo}')).toBe('/home/me/code/wt/app');
    expect(worktreesDirFor('/home/me/code/app', '.worktrees')).toBe('/home/me/code/app/.worktrees');
    expect(worktreesDirFor('/home/me/code/app', '/srv/wt/{repo}', 'my-app')).toBe('/srv/wt/my-app');
    expect(worktreesDirFor('/app', '../../../x')).toBe('/x');
    expect(defaultWorktreePath({ baseDir: '/home/me/code/app' }, 'x', '../{repo}-worktrees')).toBe('/home/me/code/app-worktrees/x');
  });

  it('compares paths loosely', () => {
    expect(samePath('C:\\a\\b\\', 'c:/a/b')).toBe(true);
    expect(samePath('/a/b', '/a/B')).toBe(false);
  });

  it('builds and validates worktreeAdd arguments', () => {
    const p = { baseDir: '/code/app' };
    expect(worktreeAddArgs(p, { branch: ' CTX-1-x ', base: 'main', path: '/wt/CTX-1-x', newBranch: true })).toEqual({
      repoDir: '/code/app',
      path: '/wt/CTX-1-x',
      branch: 'CTX-1-x',
      base: 'main',
      newBranch: true,
    });
    expect(worktreeAddArgs(p, { branch: 'a', base: ' ', path: '/w', newBranch: false }).base).toBeUndefined();
    expect(() => worktreeAddArgs({}, { branch: 'a', base: '', path: '/w', newBranch: true })).toThrow(/Settings/);
    expect(() => worktreeAddArgs({ baseDir: '~/code' }, { branch: 'a', base: '', path: '/w', newBranch: true })).toThrow(/Settings/);
    expect(() => worktreeAddArgs(p, { branch: '', base: '', path: '/w', newBranch: true })).toThrow(/Branch/);
    expect(() => worktreeAddArgs(p, { branch: 'a b', base: '', path: '/w', newBranch: true })).toThrow(/valid/);
    expect(() => worktreeAddArgs(p, { branch: 'a', base: '', path: 'rel/x', newBranch: true })).toThrow(/absolute/);
  });

  it('makes unique handles', () => {
    expect(worktreeHandle('feat/CTX-1-x', [])).toBe('wt/CTX-1-x');
    expect(worktreeHandle('feat/CTX-1-x', ['wt/CTX-1-x', 'wt/CTX-1-x-2'])).toBe('wt/CTX-1-x-3');
  });

  it('finds worktrees that are not on the canvas', () => {
    const wt = (path: string) => ({ path, bare: false, prunable: false });
    const disk = [wt('C:/code/app'), wt('C:/wt/a'), wt('C:/wt/b'), { ...wt('C:/wt/gone'), prunable: true }];
    expect(untrackedWorktrees(disk, 'C:\\code\\app', ['C:\\wt\\a']).map((w) => w.path)).toEqual(['C:/wt/b']);
  });
});
