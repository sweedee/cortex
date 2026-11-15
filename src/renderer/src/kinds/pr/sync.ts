/** Background refresh of an open PR (`KindModule.sync`): `gh pr view` (state, review decision, mergeable, checks rollup). */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { isRealRepo, type ItemOf } from '../../domain';
import { native } from '../../native';
import { patchData } from '../../store';
import { changes, prChecksRunning, prPatch } from '../../sync/mapping';
import { currentItem } from '../common';
import type { SyncJob } from '../types';

async function refreshPr(id: string) {
  const p = currentItem(id, 'pr');
  if (!p) return;
  const pr = await native.gh.prView({ repo: p.data.repo, number: p.data.number });
  queryClient.setQueryData(qk.gh.pr(p.data.repo, p.data.number), pr);
  const cur = currentItem(id, 'pr');
  if (!cur) return;
  const patch = prPatch(pr);
  if (changes(cur.data, patch)) patchData<'pr'>(cur, patch);
}

/** Open PRs of a real repo; fast while checks run. */
export const prSync = (p: ItemOf<'pr'>): SyncJob[] =>
  p.data.state === 'open' && isRealRepo(p.data.repo) ? [{ id: p.id, group: `gh:${p.data.repo}`, fast: prChecksRunning(p.data), run: () => refreshPr(p.id) }] : [];
