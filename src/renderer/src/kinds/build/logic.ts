/** Pure build helpers: ring, rerun availability, Jenkins detection, `gh run view` → data patch. */
import type { GhRun } from '../../../../shared/integrations/github';
import type { BuildData, ItemOf, Segment } from '../../domain';

type Build = ItemOf<'build'>;

export const buildFailed = (b: Build) => b.data.state === 'completed' && (b.data.conclusion === 'failure' || b.data.conclusion === 'timed_out');

export function buildRing(b: Build): Segment[] {
  const d = b.data;
  if (d.state === 'queued') return [{ tone: 'running', label: 'Queued' }];
  if (d.state === 'in_progress') return [{ tone: 'running', label: d.stage ? `Running · ${d.stage}` : 'Running' }];
  if (buildFailed(b)) return [{ tone: 'critical', label: d.stage ? `Failed · ${d.stage}` : 'Failed' }];
  if (d.conclusion === 'cancelled' || d.conclusion === 'skipped') return [{ tone: 'neutral', label: d.conclusion === 'cancelled' ? 'Cancelled' : 'Skipped' }];
  return [{ tone: 'success', label: 'Passed' }];
}

export const duration = (s?: number) => (s == null ? '–' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

const hostOf = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return undefined;
  }
};

/** A Jenkins page: "jenkins" in the host, or Jenkins' `/job/<name>/` path shape on a non-GitHub host. */
export function isJenkinsUrl(url: string | undefined): boolean {
  if (!url) return false;
  const u = hostOf(url);
  if (!u) return false;
  if (/jenkins/i.test(u.hostname)) return true;
  return !/github\.com$/i.test(u.hostname) && /\/job\/[^/]+/.test(u.pathname);
}

/**
 * The CI system behind a build. GitHub Actions is fully integrated (`gh run view` / `gh run rerun`);
 * any other CI that reports through the GitHub checks API (Jenkins, Buildkite, …) only has its details
 * page. A new integrated provider adds an id here plus its data hook / rerun op.
 */
export interface CiProvider {
  id: 'github-actions' | 'jenkins' | 'other';
  /** display name ("GitHub Actions", "Jenkins", the details host, or "CI") */
  name: string;
  /** jobs / steps, rerun through the app */
  integrated: boolean;
  /** webview partition of its details page (logins are kept per partition) */
  partition: 'persist:github' | 'persist:ci';
}

const isActionsRun = (d: Pick<BuildData, 'runId' | 'repo'>) => !!d.runId && /^\d+$/.test(d.runId) && /^[\w.-]+\/[\w.-]+$/.test(d.repo);

export function ciProvider(d: Pick<BuildData, 'runId' | 'repo' | 'url'>): CiProvider {
  if (isActionsRun(d) || /github\.com\/.+\/actions\/runs\/\d+/i.test(d.url ?? '')) return { id: 'github-actions', name: 'GitHub Actions', integrated: isActionsRun(d), partition: 'persist:github' };
  if (isJenkinsUrl(d.url)) return { id: 'jenkins', name: 'Jenkins', integrated: false, partition: 'persist:ci' };
  const host = d.url ? hostOf(d.url)?.hostname : undefined;
  return { id: 'other', name: host && !/github\.com$/i.test(host) ? host : 'CI', integrated: false, partition: /github\.com$/i.test(host ?? '') ? 'persist:github' : 'persist:ci' };
}

/** Label of the "open the details page" action: names the provider when it is known. */
export function externalLabel(d: Pick<BuildData, 'runId' | 'repo' | 'url'>): string {
  const p = ciProvider(d);
  return p.id === 'other' ? 'Open details' : `Open in ${p.name}`;
}

export type RerunMode = 'actions' | 'external' | 'none';

/** GitHub Actions runs rerun through gh; any other CI (via the checks API) only on its own page. */
export const rerunMode = (d: BuildData): RerunMode => (isActionsRun(d) ? 'actions' : d.url ? 'external' : 'none');

export function rerunBlocked(d: BuildData): string | undefined {
  const mode = rerunMode(d);
  if (mode === 'none') return 'No run id and no details URL';
  if (mode === 'actions' && d.state !== 'completed') return 'Still running';
  return undefined;
}

const RUN_CONCLUSION: Record<string, BuildData['conclusion']> = {
  success: 'success',
  failure: 'failure',
  cancelled: 'cancelled',
  skipped: 'skipped',
  timed_out: 'timed_out',
  neutral: 'neutral',
  startup_failure: 'failure',
  action_required: 'failure',
  stale: 'neutral',
};

const secsBetween = (a?: string, b?: string) => {
  const x = a ? Date.parse(a) : NaN;
  const y = b ? Date.parse(b) : NaN;
  return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 1000) : undefined;
};

/** The job a run is at (running) or failed in, for `stage`. */
export function stageOf(run: GhRun): string | undefined {
  const jobs = run.jobs ?? [];
  if (run.status !== 'completed') return jobs.find((j) => j.status === 'in_progress')?.name;
  return jobs.find((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out')?.name;
}

/** `gh run view` → the build item's cached fields. */
export function runPatch(run: GhRun): Partial<BuildData> {
  const done = run.status === 'completed';
  const stage = stageOf(run);
  const dur = done ? secsBetween(run.startedAt, run.updatedAt) : undefined;
  return {
    state: done ? 'completed' : run.status === 'in_progress' ? 'in_progress' : 'queued',
    conclusion: done ? (RUN_CONCLUSION[run.conclusion] ?? 'neutral') : undefined,
    number: run.number,
    url: run.url || undefined,
    branch: run.headBranch || undefined,
    trigger: run.event || undefined,
    ...(dur != null ? { durationSec: dur } : {}),
    ...(stage ? { stage } : {}),
  } as Partial<BuildData>;
}

/** Only the fields of `patch` that differ from `prev` (undefined values that are already unset are dropped). */
export function diffPatch<D extends object>(prev: D, patch: Partial<D>): Partial<D> {
  const out: Partial<D> = {};
  for (const [k, v] of Object.entries(patch)) {
    const old = (prev as Record<string, unknown>)[k];
    if (v === undefined && old === undefined) continue;
    if (v === undefined && (k === 'url' || k === 'branch')) continue; // never blank these
    if (JSON.stringify(old) !== JSON.stringify(v)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
