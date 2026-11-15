/**
 * Background refresh of a build that is not completed (`KindModule.sync`): `gh run view` for a
 * GitHub Actions run, or, for other CI linked to a PR, that PR's `gh pr checks` (one shared job per
 * PR, `checks:<repo>#<n>`, covers all its builds). Both poll fast.
 */
import { codeHost } from '../../data/codehost';
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { isRealRepo, type ItemOf } from '../../domain';
import { getState, patchData } from '../../store';
import { planBuildSync } from '../../sync/checks';
import type { CodeHostId } from '../../../../shared/codeHost';
import { currentItem } from '../common';
import type { SyncJob } from '../types';
import { diffPatch, runPatch } from './logic';

async function refreshBuildRun(id: string) {
  const b = currentItem(id, 'build');
  if (!b) return;
  const runId = Number(b.data.runId);
  const run = await codeHost(b.data.provider).runView(b.data.repo, runId);
  queryClient.setQueryData(qk.gh.run(b.data.repo, runId), run);
  const cur = currentItem(id, 'build');
  if (!cur) return;
  const patch = diffPatch(cur.data, runPatch(run));
  if (Object.keys(patch).length) patchData<'build'>(cur, patch);
}

/** The PR's checks → its existing build items (never creates any; that is the PR sidebar's "Add to canvas"). */
async function refreshPrChecks(repo: string, number: number, branch: string, provider?: CodeHostId) {
  const checks = await codeHost(provider).prChecks(repo, number);
  queryClient.setQueryData(qk.gh.checks(repo, number), checks);
  const items = getState().items;
  const pr =
    items.find((i): i is ItemOf<'pr'> => i.kind === 'pr' && i.data.repo === repo && i.data.number === number) ??
    ({ id: '', kind: 'pr', data: { repo, number, headBranch: branch } } as unknown as ItemOf<'pr'>);
  for (const u of planBuildSync(items, pr, checks).updates) patchData<'build'>(u.id, u.patch);
}

export function buildSync(b: ItemOf<'build'>): SyncJob[] {
  const d = b.data;
  if (d.state === 'completed' || !isRealRepo(d.repo)) return [];
  if (d.runId && /^\d+$/.test(d.runId)) return [{ id: b.id, group: `gh:${d.repo}`, fast: true, run: () => refreshBuildRun(b.id) }];
  // other CI (Jenkins…) only shows up in the PR's checks: one job per PR covers all its builds (the refresher keeps the first)
  if (d.prNumber) return [{ id: `checks:${d.repo}#${d.prNumber}`, group: `gh:${d.repo}`, fast: true, run: () => refreshPrChecks(d.repo, d.prNumber!, d.branch, d.provider) }];
  return [];
}
