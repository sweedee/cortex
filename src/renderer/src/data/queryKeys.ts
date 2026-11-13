/**
 * Query key convention: `[integration, resource, ...params]`, built only through these
 * factories, so invalidation after an action can target a whole integration, a resource,
 * or one entity:
 *
 *   queryClient.invalidateQueries({ queryKey: qk.gh.all })            // everything from gh
 *   queryClient.invalidateQueries({ queryKey: qk.gh.pr(repo, 482) })   // one PR
 *
 * Add an integration as a new top-level entry; keep params serialisable.
 */
export const qk = {
  app: {
    all: ['app'] as const,
    info: () => ['app', 'info'] as const,
  },
  // phase 1 fills these in (shapes are the convention, not final):
  gh: {
    all: ['gh'] as const,
    pr: (repo: string, number: number) => ['gh', 'pr', repo, number] as const,
    checks: (repo: string, number: number) => ['gh', 'checks', repo, number] as const,
  },
  git: {
    all: ['git'] as const,
    status: (path: string) => ['git', 'status', path] as const,
    diff: (path: string, base: string) => ['git', 'diff', path, base] as const,
  },
  jira: {
    all: ['jira'] as const,
    issue: (key: string) => ['jira', 'issue', key] as const,
  },
  proc: {
    all: ['proc'] as const,
    list: () => ['proc', 'list'] as const,
  },
} as const;
