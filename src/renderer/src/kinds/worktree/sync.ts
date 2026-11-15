/** Background refresh of a worktree (`KindModule.sync`): `git status` + ahead / behind its base branch. */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { isRealPath, type ItemOf } from '../../domain';
import { native } from '../../native';
import { patchData } from '../../store';
import { changes, worktreeGitPatch } from '../../sync/mapping';
import { currentItem } from '../common';
import type { SyncJob } from '../types';

async function refreshWorktree(id: string) {
  const w = currentItem(id, 'worktree');
  if (!w) return;
  const dir = w.data.path;
  const status = await native.git.status({ dir });
  queryClient.setQueryData(qk.git.status(dir), status);
  const count = async (range: string) => (await native.git.log({ dir, range, limit: 500 })).length;
  let vsBase: { ahead: number; behind: number } | null = null;
  for (const base of [`origin/${w.data.baseBranch}`, w.data.baseBranch]) {
    try {
      vsBase = { ahead: await count(`${base}..HEAD`), behind: await count(`HEAD..${base}`) };
      break;
    } catch {
      /* no such ref: try the local branch, then fall back to the upstream numbers */
    }
  }
  const cur = currentItem(id, 'worktree');
  if (!cur) return;
  const patch = worktreeGitPatch(status, vsBase);
  if (changes(cur.data, patch)) patchData<'worktree'>(cur, patch);
}

/** Paths that are not absolute (demo data like `~/wt/…`) are skipped without calling git. */
export const worktreeSync = (w: ItemOf<'worktree'>): SyncJob[] => (isRealPath(w.data.path) ? [{ id: w.id, fast: false, run: () => refreshWorktree(w.id) }] : []);
