/** GitHub (`native.gh.*`): PRs, checks, runs, Renovate, and the write ops. */
import { useQuery } from '@tanstack/react-query';
import { rollupBuckets, summarizePr, type GhMergeMethod } from '../../../shared/integrations/github';
import type { GhPrCreateRequest, GhPrEditRequest } from '../../../shared/ipc';
import { native } from '../native';
import { getState } from '../store';
import { invalidate, pollWhile, ready } from './ops';
import { qk, type PrFilter } from './queryKeys';

/** Full PR (`gh pr view`): body, files, comments, reviews, mergeable, check rollup. */
export function usePr(repo: string | undefined, number: number | undefined) {
  return useQuery({ queryKey: qk.gh.pr(repo ?? '', number ?? 0), queryFn: () => native.gh.prView(repo!, number!), enabled: ready(repo, number) });
}

/** The same query reduced to `PrSummary` (state, checks rollup, behind, conflicts). */
export function usePrSummary(repo: string | undefined, number: number | undefined) {
  return useQuery({ queryKey: qk.gh.pr(repo ?? '', number ?? 0), queryFn: () => native.gh.prView(repo!, number!), enabled: ready(repo, number), select: summarizePr });
}

export function usePrDiff(repo: string | undefined, number: number | undefined) {
  return useQuery({ queryKey: qk.gh.prDiff(repo ?? '', number ?? 0), queryFn: () => native.gh.prDiff(repo!, number!), enabled: ready(repo, number), staleTime: 60_000 });
}

/** `gh pr checks`; polls every 15 s while any check is pending. */
export function usePrChecks(repo: string | undefined, number: number | undefined) {
  return useQuery({
    queryKey: qk.gh.checks(repo ?? '', number ?? 0),
    queryFn: () => native.gh.prChecks(repo!, number!),
    enabled: ready(repo, number),
    refetchInterval: (q) => pollWhile(!!q.state.data && rollupBuckets(q.state.data) === 'pending'),
  });
}

export function usePrList(repo: string | undefined, filter: PrFilter = {}) {
  return useQuery({ queryKey: qk.gh.prList(repo ?? '', filter), queryFn: () => native.gh.prList(repo!, filter), enabled: ready(repo) });
}

export function useRenovatePrs(repo: string | undefined) {
  return useQuery({ queryKey: qk.gh.renovate(repo ?? ''), queryFn: () => native.gh.renovatePrs(repo!), enabled: ready(repo) });
}

/** A workflow run with its jobs; polls while it is not completed. */
export function useRun(repo: string | undefined, runId: number | undefined) {
  return useQuery({
    queryKey: qk.gh.run(repo ?? '', runId ?? 0),
    queryFn: () => native.gh.runView(repo!, runId!),
    enabled: ready(repo, runId),
    refetchInterval: (q) => pollWhile(!!q.state.data && q.state.data.status !== 'completed'),
  });
}

/** Writes. Each invalidates what it changes. */
export const ghOps = {
  async prCreate(req: GhPrCreateRequest) {
    const r = await native.gh.prCreate(req);
    await invalidate(req.repo ? qk.gh.prs(req.repo) : qk.gh.all);
    return r;
  },
  async prMerge(repo: string, number: number, method: GhMergeMethod, opts?: { deleteBranch?: boolean }) {
    await native.gh.prMerge(repo, number, method, opts);
    await invalidate(qk.gh.pr(repo, number), qk.gh.prs(repo));
  },
  async prComment(repo: string, number: number, body: string) {
    const r = await native.gh.prComment(repo, number, body);
    await invalidate(qk.gh.pr(repo, number));
    return r;
  },
  /** Posts the AI-review trigger comment (config.json `github.aiReviewComment`). */
  async requestAiReview(repo: string, number: number) {
    const r = await native.gh.prComment(repo, number, getState().settings.aiReviewComment);
    await invalidate(qk.gh.pr(repo, number));
    return r;
  },
  async prUpdateBranch(repo: string, number: number, opts?: { rebase?: boolean }) {
    const r = await native.gh.prUpdateBranch(repo, number, opts);
    await invalidate(qk.gh.pr(repo, number));
    return r;
  },
  /** `gh pr edit` (e.g. retarget a stacked PR onto `base` after its parent merged). */
  async prEdit(req: GhPrEditRequest) {
    await native.gh.prEdit(req);
    await invalidate(qk.gh.pr(req.repo, req.number), qk.gh.prs(req.repo));
  },
  async runRerun(repo: string, runId: number, opts?: { failedOnly?: boolean }) {
    await native.gh.runRerun(repo, runId, opts);
    await invalidate(qk.gh.run(repo, runId));
  },
};
