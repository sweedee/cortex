/** Real `git` (shell-less, via the Runner). Parsers live in `shared/integrations/git.ts`. */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  GIT_LOG_FORMAT,
  parseLog,
  parseNumstat,
  parseRemoteRepo,
  parseStatusV2,
  parseWorktreeList,
  type GitDiffStat,
  type GitLogEntry,
  type GitRebaseResult,
  type GitStatus,
  type GitWorktree,
} from '../../shared/integrations/git';
import { CliError, defaultRunner, runOk, type Runner } from './cli';

/** never wait for an editor or a credential prompt */
const NON_INTERACTIVE = { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' };

export interface DiffOptions {
  /** diff against the merge base with this ref (`git diff --merge-base <base>`), working tree included */
  base?: string;
  /** only staged changes */
  staged?: boolean;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export class GitService {
  private run: Runner;
  constructor(run: Runner = defaultRunner) {
    this.run = run;
  }

  private git(dir: string, args: string[], timeoutMs?: number) {
    return runOk(this.run, 'git', args, { cwd: dir, env: NON_INTERACTIVE, timeoutMs });
  }

  async isRepo(dir: string): Promise<boolean> {
    if (!existsSync(dir)) return false;
    const r = await this.run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, env: NON_INTERACTIVE });
    return r.code === 0 && r.stdout.trim() === 'true';
  }

  /** short branch name, null when detached */
  async currentBranch(dir: string): Promise<string | null> {
    const r = await this.run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: dir, env: NON_INTERACTIVE });
    if (r.code === 0) return r.stdout.trim();
    if (r.code === 1) return null; // detached
    throw new CliError('git', ['symbolic-ref'], r);
  }

  /** `owner/name` of a remote (default origin), null when absent or not GitHub-shaped */
  async remoteRepo(dir: string, remote = 'origin'): Promise<string | null> {
    const r = await this.run('git', ['remote', 'get-url', remote], { cwd: dir, env: NON_INTERACTIVE });
    return r.code === 0 ? parseRemoteRepo(r.stdout) : null;
  }

  async worktreeList(repoDir: string): Promise<GitWorktree[]> {
    return parseWorktreeList(await this.git(repoDir, ['worktree', 'list', '--porcelain']));
  }

  /**
   * `newBranch`: `git worktree add -b <branch> <path> <base>`; else check out an existing branch:
   * `git worktree add <path> <branch>`.
   */
  async worktreeAdd(repoDir: string, path: string, branch: string, base: string | undefined, opts: { newBranch?: boolean } = {}): Promise<GitWorktree> {
    const args = opts.newBranch ? ['worktree', 'add', '-b', branch, path, ...(base ? [base] : [])] : ['worktree', 'add', path, branch];
    await this.git(repoDir, args);
    const abs = isAbsolute(path) ? path : join(repoDir, path);
    const wt = (await this.worktreeList(repoDir)).find((w) => norm(w.path) === norm(abs));
    if (!wt) throw new Error(`git worktree add succeeded but ${abs} is not listed`);
    return wt;
  }

  async worktreeRemove(repoDir: string, path: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.git(repoDir, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), path]);
  }

  async status(dir: string): Promise<GitStatus> {
    const s = parseStatusV2(await this.git(dir, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']));
    const gitDir = (await this.git(dir, ['rev-parse', '--absolute-git-dir'])).trim();
    s.rebasing = existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'));
    return s;
  }

  private diffArgs(opts: DiffOptions) {
    if (opts.staged) return ['--cached', ...(opts.base ? [opts.base] : [])];
    return opts.base ? ['--merge-base', opts.base] : [];
  }

  /** unified diff text */
  diff(dir: string, opts: DiffOptions = {}): Promise<string> {
    return this.git(dir, ['diff', '--no-color', '--no-ext-diff', ...this.diffArgs(opts)]);
  }

  async diffStat(dir: string, opts: DiffOptions = {}): Promise<GitDiffStat> {
    return parseNumstat(await this.git(dir, ['diff', '--numstat', '-z', '--no-color', ...this.diffArgs(opts)]));
  }

  /** `range` e.g. `origin/main..HEAD`; default the last `limit` (50) commits of HEAD */
  async log(dir: string, opts: { range?: string; limit?: number } = {}): Promise<GitLogEntry[]> {
    const args = ['log', `--format=${GIT_LOG_FORMAT}`, '-n', String(opts.limit ?? 50)];
    if (opts.range) args.push(opts.range, '--');
    return parseLog(await this.git(dir, args));
  }

  async fetch(dir: string, opts: { remote?: string; prune?: boolean } = {}): Promise<void> {
    await this.git(dir, ['fetch', ...(opts.prune ? ['--prune'] : []), opts.remote ?? '--all'], 300_000);
  }

  /** files with unresolved conflicts */
  async conflicts(dir: string): Promise<string[]> {
    const out = await this.git(dir, ['diff', '--name-only', '--diff-filter=U', '-z']);
    return out.split('\0').filter(Boolean);
  }

  /** `git rebase <onto>`; stops (not aborts) on conflicts so they can be resolved or aborted */
  async rebase(dir: string, onto: string): Promise<GitRebaseResult> {
    const r = await this.run('git', ['rebase', onto], { cwd: dir, env: NON_INTERACTIVE, timeoutMs: 300_000 });
    if (r.code === 0) return { ok: true };
    const conflicts = await this.conflicts(dir).catch(() => []);
    if (conflicts.length > 0) return { ok: false, conflicts };
    throw new CliError('git', ['rebase', onto], r);
  }

  /** `git push [-u] <remote> HEAD`: pushes the current branch under its own name */
  async push(dir: string, opts: { remote?: string; setUpstream?: boolean } = {}): Promise<void> {
    await this.git(dir, ['push', ...(opts.setUpstream ? ['-u'] : []), opts.remote ?? 'origin', 'HEAD'], 300_000);
  }

  async rebaseAbort(dir: string): Promise<void> {
    await this.git(dir, ['rebase', '--abort']);
  }
}
