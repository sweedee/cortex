/**
 * Build items from a PR's checks (`gh pr checks`): one build bubble per check, deduped by
 * repo + name + PR number. Existing ones are updated in place; missing ones are only created
 * when the user asks ("Add to canvas" in the PR sidebar). Pure.
 */
import type { GhCheck } from '../../../../shared/integrations/github';
import type { BuildData, Item, ItemOf, NewItem } from '../../domain';

type BuildPatch = Partial<BuildData>;

/** GitHub Actions run id in a check link (`…/actions/runs/123/job/456`). */
export const runIdFromUrl = (url: string | undefined) => /\/actions\/runs\/(\d+)/.exec(url ?? '')?.[1];

const secs = (from?: string, to?: string) => {
  const a = from ? Date.parse(from) : NaN;
  const b = to ? Date.parse(to) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a && a > 0 ? Math.round((b - a) / 1000) : undefined;
};

/** One `gh pr checks` row → build data. */
export function checkToBuild(c: GhCheck, pr: { repo: string; number: number; headBranch: string }): BuildData {
  const done = c.bucket !== 'pending';
  const conclusion: BuildData['conclusion'] = !done
    ? undefined
    : c.bucket === 'pass'
      ? 'success'
      : c.bucket === 'fail'
        ? /TIMED_OUT/i.test(c.state)
          ? 'timed_out'
          : 'failure'
        : c.bucket === 'cancel'
          ? 'cancelled'
          : 'skipped';
  const runId = runIdFromUrl(c.link);
  return {
    repo: pr.repo,
    name: c.name,
    url: c.link,
    ...(runId ? { runId } : {}),
    state: done ? 'completed' : /QUEUED|PENDING|WAITING|REQUESTED/i.test(c.state) ? 'queued' : 'in_progress',
    ...(conclusion ? { conclusion } : {}),
    prNumber: pr.number,
    branch: pr.headBranch,
    ...(c.workflow && c.workflow !== c.name ? { stage: c.workflow } : {}),
    ...(c.event ? { trigger: c.event } : {}),
    ...(secs(c.startedAt, c.completedAt) != null ? { durationSec: secs(c.startedAt, c.completedAt) } : {}),
  };
}

export const buildKey = (repo: string, name: string, prNumber: number | undefined) => `${repo}#${prNumber ?? '-'}:${name}`;

export interface BuildSync {
  updates: { id: string; patch: BuildPatch }[];
  creates: NewItem[];
}

const SAME: (keyof BuildData)[] = ['url', 'runId', 'state', 'conclusion', 'branch', 'trigger', 'durationSec'];

/**
 * What to change for these checks: patches for existing build items (only fields that differ;
 * the stage is kept when the item has its own), and new items for checks without one.
 */
export function planBuildSync(items: Item[], pr: ItemOf<'pr'>, checks: GhCheck[]): BuildSync {
  const builds = new Map<string, ItemOf<'build'>>();
  for (const i of items) if (i.kind === 'build') builds.set(buildKey(i.data.repo, i.data.name, i.data.prNumber), i);
  const out: BuildSync = { updates: [], creates: [] };
  const seen = new Set<string>();
  for (const c of checks) {
    const key = buildKey(pr.data.repo, c.name, pr.data.number);
    if (seen.has(key)) continue;
    seen.add(key);
    const data = checkToBuild(c, pr.data);
    const cur = builds.get(key);
    if (cur) {
      const patch: BuildPatch = {};
      for (const k of SAME) if (JSON.stringify(cur.data[k]) !== JSON.stringify(data[k])) (patch as Record<string, unknown>)[k] = data[k];
      if (Object.keys(patch).length) out.updates.push({ id: cur.id, patch });
    } else {
      out.creates.push({
        kind: 'build',
        handle: `${c.name} · #${pr.data.number}`,
        title: `${c.name} · PR #${pr.data.number}`,
        projectId: pr.projectId,
        data,
      });
    }
  }
  return out;
}
