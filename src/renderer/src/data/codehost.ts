/**
 * Code host dispatch: `codeHost(item.data.provider)` is the `CodeHost` (`shared/codeHost.ts`) for a
 * project / pr / build; absent = GitHub. Plus the read hooks over it. Kinds and sync jobs use
 * these instead of `native.gh` / GitHub URLs, so a second provider is one more implementation here.
 *
 * Query keys are still `qk.gh.*`: with a second provider, give it its own key prefix.
 */
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_CODE_HOST, type CodeHost, type CodeHostId, type CodeHostPrFilter } from '../../../shared/codeHost';
import { rollupBuckets } from '../../../shared/integrations/github';
import { github } from './gh';
import { pollWhile, ready } from './ops';
import { qk } from './queryKeys';

const HOSTS: Record<CodeHostId, CodeHost> = { github };

/** The code host of an item's data (`provider`, absent = github). */
export const codeHost = (provider: CodeHostId | undefined = DEFAULT_CODE_HOST): CodeHost => HOSTS[provider] ?? github;

/** Full PR: body, files, comments, reviews, mergeable, check rollup. */
export function usePr(repo: string | undefined, number: number | undefined, provider?: CodeHostId) {
  return useQuery({ queryKey: qk.gh.pr(repo ?? '', number ?? 0), queryFn: () => codeHost(provider).prView(repo!, number!), enabled: ready(repo, number) });
}

export function usePrDiff(repo: string | undefined, number: number | undefined, provider?: CodeHostId) {
  return useQuery({ queryKey: qk.gh.prDiff(repo ?? '', number ?? 0), queryFn: () => codeHost(provider).prDiff(repo!, number!), enabled: ready(repo, number), staleTime: 60_000 });
}

/** The PR's checks; polls every 15 s while any check is pending. */
export function usePrChecks(repo: string | undefined, number: number | undefined, provider?: CodeHostId) {
  return useQuery({
    queryKey: qk.gh.checks(repo ?? '', number ?? 0),
    queryFn: () => codeHost(provider).prChecks(repo!, number!),
    enabled: ready(repo, number),
    refetchInterval: (q) => pollWhile(!!q.state.data && rollupBuckets(q.state.data) === 'pending'),
  });
}

export function usePrList(repo: string | undefined, filter: CodeHostPrFilter = {}, provider?: CodeHostId) {
  return useQuery({ queryKey: qk.gh.prList(repo ?? '', filter), queryFn: () => codeHost(provider).prList(repo!, filter), enabled: ready(repo) });
}

/** Dependency-update PRs (Renovate). */
export function useDependencyPrs(repo: string | undefined, provider?: CodeHostId) {
  return useQuery({ queryKey: qk.gh.renovate(repo ?? ''), queryFn: () => codeHost(provider).dependencyPrs(repo!), enabled: ready(repo) });
}

/** A CI run with its jobs; polls while it is not completed. */
export function useRun(repo: string | undefined, runId: number | undefined, provider?: CodeHostId) {
  return useQuery({
    queryKey: qk.gh.run(repo ?? '', runId ?? 0),
    queryFn: () => codeHost(provider).runView(repo!, runId!),
    enabled: ready(repo, runId),
    refetchInterval: (q) => pollWhile(!!q.state.data && q.state.data.status !== 'completed'),
  });
}
