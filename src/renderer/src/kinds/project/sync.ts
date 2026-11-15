/** Background refresh of a project (`KindModule.sync`): open PR count, Renovate PR count. */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { isRealRepo, type ItemOf } from '../../domain';
import { native } from '../../native';
import { patchData } from '../../store';
import { changes, projectStatsPatch } from '../../sync/mapping';
import { currentItem } from '../common';
import type { SyncJob } from '../types';

async function refreshProject(id: string) {
  const p = currentItem(id, 'project');
  if (!p) return;
  const repo = p.data.repo;
  const [open, renovate] = await Promise.all([native.gh.prList({ repo, state: 'open', limit: 200 }), native.gh.renovatePrs({ repo })]);
  queryClient.setQueryData(qk.gh.prList(repo, { state: 'open', limit: 200 }), open);
  queryClient.setQueryData(qk.gh.renovate(repo), renovate);
  const cur = currentItem(id, 'project');
  if (!cur) return;
  const patch = projectStatsPatch(cur.data, open.length, renovate.length);
  if (changes(cur.data, patch)) patchData<'project'>(cur, patch);
}

export const projectSync = (p: ItemOf<'project'>): SyncJob[] => (isRealRepo(p.data.repo) ? [{ id: p.id, group: `gh:${p.data.repo}`, fast: false, run: () => refreshProject(p.id) }] : []);
