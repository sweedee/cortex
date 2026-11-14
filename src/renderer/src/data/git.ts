/** git (`native.git.*`): read hooks keyed by checkout dir, and the write ops. */
import { useQuery } from '@tanstack/react-query';
import { native } from '../native';
import { invalidate, ready } from './ops';
import { qk } from './queryKeys';

/** `git status` of a checkout (branch, upstream, ahead / behind, changed files). */
export function useGitStatus(dir: string | undefined) {
  return useQuery({ queryKey: qk.git.status(dir ?? ''), queryFn: () => native.git.status(dir!), enabled: ready(dir), staleTime: 10_000 });
}

/** Unified diff of the working tree against the merge base with `base` (or HEAD when unset). */
export function useGitDiff(dir: string | undefined, base?: string) {
  return useQuery({ queryKey: qk.git.diff(dir ?? '', base), queryFn: () => native.git.diff(dir!, { base }), enabled: ready(dir), staleTime: 10_000 });
}

export function useGitDiffStat(dir: string | undefined, base?: string) {
  return useQuery({ queryKey: qk.git.diffStat(dir ?? '', base), queryFn: () => native.git.diffStat(dir!, { base }), enabled: ready(dir), staleTime: 10_000 });
}

export function useGitLog(dir: string | undefined, opts: { range?: string; limit?: number } = {}) {
  return useQuery({ queryKey: qk.git.log(dir ?? '', opts.range, opts.limit), queryFn: () => native.git.log(dir!, opts), enabled: ready(dir) });
}

/** Current branch (null = detached). */
export function useCurrentBranch(dir: string | undefined) {
  return useQuery({ queryKey: qk.git.branch(dir ?? ''), queryFn: () => native.git.currentBranch(dir!), enabled: ready(dir) });
}

/** `owner/name` of the origin remote (null = not GitHub-like). */
export function useRemoteRepo(dir: string | undefined) {
  return useQuery({ queryKey: qk.git.remote(dir ?? ''), queryFn: () => native.git.remoteRepo(dir!), enabled: ready(dir), staleTime: Infinity });
}

/** `git worktree list` of a repo (the main checkout first). */
export function useWorktrees(repoDir: string | undefined) {
  return useQuery({ queryKey: qk.git.worktrees(repoDir ?? ''), queryFn: () => native.git.worktreeList(repoDir!), enabled: ready(repoDir) });
}

/** Writes. Each invalidates what it changes. */
export const gitOps = {
  async worktreeAdd(repoDir: string, path: string, branch: string, base?: string, opts?: { newBranch?: boolean }) {
    const wt = await native.git.worktreeAdd(repoDir, path, branch, base, opts);
    await invalidate(qk.git.worktrees(repoDir));
    return wt;
  },
  async worktreeRemove(repoDir: string, path: string, opts?: { force?: boolean }) {
    await native.git.worktreeRemove(repoDir, path, opts);
    await invalidate(qk.git.worktrees(repoDir), qk.git.dir(path));
  },
  async fetch(dir: string, opts?: { remote?: string; prune?: boolean }) {
    await native.git.fetch(dir, opts);
    await invalidate(qk.git.dir(dir));
  },
  async rebase(dir: string, onto: string) {
    const r = await native.git.rebase(dir, onto);
    await invalidate(qk.git.dir(dir));
    return r;
  },
  async push(dir: string, opts?: { remote?: string; setUpstream?: boolean }) {
    await native.git.push(dir, opts);
    await invalidate(qk.git.dir(dir));
  },
  async rebaseAbort(dir: string) {
    await native.git.rebaseAbort(dir);
    await invalidate(qk.git.dir(dir));
  },
  /** Remote `owner/name` and current branch of a directory, for setup forms (null = not a git repo). */
  async detect(dir: string): Promise<{ repo: string | null; branch: string | null } | null> {
    if (!(await native.git.isRepo(dir).catch(() => false))) return null;
    const [repo, branch] = await Promise.all([native.git.remoteRepo(dir).catch(() => null), native.git.currentBranch(dir).catch(() => null)]);
    return { repo, branch };
  },
};
