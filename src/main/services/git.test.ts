import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExec } from '../lib/exec';
import { GitService } from './git';

const git = new GitService();
let root: string;
let repo: string;

async function sh(cwd: string, ...args: string[]) {
  const r = await runExec({ cmd: 'git', args, cwd, env: { GIT_EDITOR: 'true' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

async function commit(file: string, text: string, msg: string) {
  writeFileSync(join(repo, file), text);
  await sh(repo, 'add', file);
  await sh(repo, 'commit', '-q', '-m', msg);
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cortex-git-')));
  repo = join(root, 'repo');
  await runExec({ cmd: 'git', args: ['init', '-q', '-b', 'main', repo], cwd: root });
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ])
    await sh(repo, 'config', k, v);
  await sh(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
  await commit('a.txt', 'one\ntwo\nthree\n', 'initial');
}, 30_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('GitService (real git, temp repo)', () => {
  it('detects repos, branch and remote', async () => {
    expect(await git.isRepo(repo)).toBe(true);
    expect(await git.isRepo(root)).toBe(false);
    expect(await git.isRepo(join(root, 'nope'))).toBe(false);
    expect(await git.currentBranch(repo)).toBe('main');
    expect(await git.remoteRepo(repo)).toBe('acme/widget');
    expect(await git.remoteRepo(repo, 'upstream')).toBeNull();
  });

  it('reports status with changed, untracked and renamed files', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(repo, 'new file.txt'), 'x');
    const s = await git.status(repo);
    expect(s.branch).toBe('main');
    expect(s.dirty).toBe(true);
    expect(s.rebasing).toBe(false);
    expect(s.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'a.txt', index: '.', worktree: 'M', kind: 'changed' }),
        expect.objectContaining({ path: 'new file.txt', kind: 'untracked' }),
      ]),
    );
    const stat = await git.diffStat(repo);
    expect(stat).toEqual({ files: [{ path: 'a.txt', additions: 1, deletions: 1 }], additions: 1, deletions: 1 });
    expect(await git.diff(repo)).toContain('+TWO');
    expect(await git.diff(repo, { staged: true })).toBe('');
    await sh(repo, 'checkout', '--', 'a.txt');
    rmSync(join(repo, 'new file.txt'));
    expect((await git.status(repo)).dirty).toBe(false);
  });

  it('lists, adds and removes worktrees', async () => {
    const wtPath = join(root, 'wt-feature');
    const wt = await git.worktreeAdd(repo, wtPath, 'feature/x', 'main', { newBranch: true });
    expect(wt.branch).toBe('feature/x');
    const list = await git.worktreeList(repo);
    expect(list.map((w) => w.branch)).toEqual(['main', 'feature/x']);
    expect(await git.currentBranch(wtPath)).toBe('feature/x');

    // diff / log against the base from inside the worktree
    writeFileSync(join(wtPath, 'b.txt'), 'b\n');
    await sh(wtPath, 'add', 'b.txt');
    await sh(wtPath, 'commit', '-q', '-m', 'add b');
    const log = await git.log(wtPath, { range: 'main..HEAD' });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ subject: 'add b', author: 'Test', email: 'test@example.com' });
    expect(log[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await git.diffStat(wtPath, { base: 'main' })).files).toEqual([{ path: 'b.txt', additions: 1, deletions: 0 }]);

    await git.worktreeRemove(repo, wtPath);
    expect((await git.worktreeList(repo)).map((w) => w.branch)).toEqual(['main']);
    // an existing branch can be checked out again
    const again = await git.worktreeAdd(repo, wtPath, 'feature/x', undefined);
    expect(again.branch).toBe('feature/x');
    writeFileSync(join(wtPath, 'dirty.txt'), 'x');
    await expect(git.worktreeRemove(repo, wtPath)).rejects.toThrow(/untracked|modified/);
    await git.worktreeRemove(repo, wtPath, { force: true });
  }, 30_000);

  it('rebases cleanly, and reports conflicts that can be aborted', async () => {
    await sh(repo, 'checkout', '-q', '-b', 'topic');
    await commit('c.txt', 'c\n', 'topic: c');
    await sh(repo, 'checkout', '-q', 'main');
    await commit('d.txt', 'd\n', 'main: d');
    await sh(repo, 'checkout', '-q', 'topic');
    expect(await git.rebase(repo, 'main')).toEqual({ ok: true });
    expect((await git.log(repo, { limit: 3 })).map((c) => c.subject)).toEqual(['topic: c', 'main: d', 'initial']);

    await commit('a.txt', 'one\ntopic\nthree\n', 'topic edits a');
    await sh(repo, 'checkout', '-q', 'main');
    await commit('a.txt', 'one\nmain\nthree\n', 'main edits a');
    await sh(repo, 'checkout', '-q', 'topic');
    const r = await git.rebase(repo, 'main');
    expect(r).toEqual({ ok: false, conflicts: ['a.txt'] });
    const during = await git.status(repo);
    expect(during.rebasing).toBe(true);
    expect(during.files).toEqual([expect.objectContaining({ path: 'a.txt', kind: 'unmerged', index: 'U', worktree: 'U' })]);
    await git.rebaseAbort(repo);
    expect((await git.status(repo)).rebasing).toBe(false);
    expect(await git.currentBranch(repo)).toBe('topic');
  }, 30_000);

  it('throws readable errors', async () => {
    await expect(git.rebase(repo, 'no-such-ref')).rejects.toThrow(/git rebase/);
    await expect(git.log(repo, { range: 'nope..HEAD' })).rejects.toThrow(/nope/);
  });
});
