import { describe, expect, it } from 'vitest';
import type { Item } from '../domain';
import { makeItem } from '../store';
import { rootsOf } from './roots';

const item = (n: Parameters<typeof makeItem>[0]) => makeItem(n);

describe('rootsOf', () => {
  it('collects the folders items work in, absolute paths only, de-duplicated', () => {
    const items: Item[] = [
      item({ kind: 'project', handle: 'p', title: 'P', data: { repo: 'o/r', baseDir: 'C:\\code\\r', worktreesDir: 'C:\\code\\wt\\r', defaultBranch: 'main' } }),
      item({ kind: 'worktree', handle: 'w', title: 'W', data: { path: 'C:\\code\\wt\\r\\feat', branch: 'feat', baseBranch: 'main' } }),
      item({ kind: 'worktree', handle: 'w2', title: 'W2', data: { path: '~/wt/demo', branch: 'x', baseBranch: 'main' } }),
      item({ kind: 'app', handle: 'a', title: 'A', data: { command: 'npm run dev', cwd: 'C:\\code\\r', state: 'stopped' } }),
      item({ kind: 'todo', handle: 't', title: 'T', data: { body: '', done: false } }),
    ];
    expect(rootsOf(items)).toEqual(['C:\\code\\r', 'C:\\code\\wt\\r', 'C:\\code\\wt\\r\\feat']);
  });
});
