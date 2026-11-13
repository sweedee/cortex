/**
 * Query key convention: `[integration, resource, ...params]`, built only through these
 * factories, so invalidation after an action can target a whole integration, a resource,
 * or one entity (keys are prefixes of each other where that is useful):
 *
 *   queryClient.invalidateQueries({ queryKey: qk.gh.all })             // everything from gh
 *   queryClient.invalidateQueries({ queryKey: qk.gh.pr(repo, 482) })    // PR 482: view, diff, checks
 *   queryClient.invalidateQueries({ queryKey: qk.gh.prs(repo) })        // every PR list of a repo
 *   queryClient.invalidateQueries({ queryKey: qk.git.dir(path) })       // status, diff, log of one checkout
 *
 * Add an integration as a new top-level entry; keep params serialisable.
 */
import type { GhPrListRequest } from '../../../shared/ipc';

export type PrFilter = Omit<GhPrListRequest, 'repo'>;

export const qk = {
  app: {
    all: ['app'] as const,
    info: () => ['app', 'info'] as const,
    config: () => ['app', 'config'] as const,
  },
  git: {
    all: ['git'] as const,
    /** everything about one checkout (prefix of status / diff / diffStat / log / branch) */
    dir: (dir: string) => ['git', 'dir', dir] as const,
    status: (dir: string) => ['git', 'dir', dir, 'status'] as const,
    diff: (dir: string, base?: string) => ['git', 'dir', dir, 'diff', base ?? null] as const,
    diffStat: (dir: string, base?: string) => ['git', 'dir', dir, 'diffStat', base ?? null] as const,
    log: (dir: string, range?: string, limit?: number) => ['git', 'dir', dir, 'log', range ?? null, limit ?? null] as const,
    branch: (dir: string) => ['git', 'dir', dir, 'branch'] as const,
    remote: (dir: string) => ['git', 'dir', dir, 'remote'] as const,
    worktrees: (repoDir: string) => ['git', 'worktrees', repoDir] as const,
  },
  gh: {
    all: ['gh'] as const,
    /** one PR (prefix of its diff and checks) */
    pr: (repo: string, number: number) => ['gh', 'pr', repo, number] as const,
    prDiff: (repo: string, number: number) => ['gh', 'pr', repo, number, 'diff'] as const,
    checks: (repo: string, number: number) => ['gh', 'pr', repo, number, 'checks'] as const,
    /** every PR list of a repo (prefix of prList / renovate) */
    prs: (repo: string) => ['gh', 'prs', repo] as const,
    prList: (repo: string, filter: PrFilter = {}) => ['gh', 'prs', repo, 'list', filter] as const,
    renovate: (repo: string) => ['gh', 'prs', repo, 'renovate'] as const,
    run: (repo: string, runId: number) => ['gh', 'run', repo, runId] as const,
  },
  jira: {
    all: ['jira'] as const,
    issue: (key: string) => ['jira', 'issue', key] as const,
    /** every search (prefix) */
    searches: () => ['jira', 'search'] as const,
    search: (jql: string, limit?: number) => ['jira', 'search', jql, limit ?? null] as const,
  },
  claude: {
    all: ['claude'] as const,
    list: () => ['claude', 'list'] as const,
    /** one session (prefix of its transcript) */
    session: (localId: string) => ['claude', 'session', localId] as const,
    transcript: (localId: string) => ['claude', 'session', localId, 'transcript'] as const,
  },
  apps: {
    all: ['apps'] as const,
    list: () => ['apps', 'list'] as const,
    log: (id: string) => ['apps', 'log', id] as const,
  },
  tests: {
    all: ['tests'] as const,
    list: () => ['tests', 'list'] as const,
    log: (id: string) => ['tests', 'log', id] as const,
  },
  proc: {
    all: ['proc'] as const,
    list: () => ['proc', 'list'] as const,
  },
} as const;
