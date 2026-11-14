import { describe, expect, it } from 'vitest';
import type { GhRun } from '../../../../shared/integrations/github';
import type { BuildData, ItemOf } from '../../domain';
import { SEED_ITEMS, SEED_LINKS } from '../../testing/fakeWorld';
import { makeCtx } from '../registry';
import { build as buildKind } from './index';
import { ciProvider, diffPatch, duration, externalLabel, isJenkinsUrl, rerunBlocked, rerunMode, runPatch, stageOf } from './logic';

const seed = (id: string) => SEED_ITEMS.find((i) => i.id === id) as ItemOf<'build'>;
const ctx = makeCtx(SEED_ITEMS, SEED_LINKS);
const actions = (b: ItemOf<'build'>) => buildKind.actions([b], ctx);
const withData = (b: ItemOf<'build'>, d: Partial<BuildData>): ItemOf<'build'> => ({ ...b, data: { ...b.data, ...d } });

const run = (o: Partial<GhRun> = {}): GhRun => ({
  databaseId: 99,
  number: 41,
  attempt: 1,
  name: 'CI',
  displayTitle: 'x',
  workflowName: 'CI',
  event: 'pull_request',
  headBranch: 'feat/x',
  headSha: 'abc',
  status: 'completed',
  conclusion: 'failure',
  url: 'https://github.com/o/r/actions/runs/99',
  createdAt: '2026-11-14T10:00:00Z',
  startedAt: '2026-11-14T10:00:00Z',
  updatedAt: '2026-11-14T10:01:30Z',
  jobs: [
    { databaseId: 1, name: 'lint', status: 'completed', conclusion: 'success', startedAt: '', completedAt: '', url: '' },
    { databaseId: 2, name: 'test', status: 'completed', conclusion: 'failure', startedAt: '', completedAt: '', url: '' },
  ],
  ...o,
});

describe('build: CI providers', () => {
  it('detects the provider', () => {
    expect(isJenkinsUrl('https://jenkins.acme.io/job/x/12/')).toBe(true);
    expect(isJenkinsUrl('https://ci.ctx.internal/job/console-ui/1838')).toBe(true);
    expect(isJenkinsUrl('https://github.com/o/r/actions/runs/1')).toBe(false);
    expect(isJenkinsUrl('https://circleci.com/gh/o/r/1')).toBe(false);
    expect(isJenkinsUrl('')).toBe(false);
    expect(ciProvider({ repo: 'o/r', runId: '7', url: 'https://github.com/o/r/actions/runs/7/job/9' })).toMatchObject({ id: 'github-actions', integrated: true, partition: 'persist:github' });
    expect(ciProvider({ repo: 'unknown/x', url: 'https://github.com/o/r/actions/runs/7' })).toMatchObject({ id: 'github-actions', integrated: false });
    expect(ciProvider({ repo: 'o/r', url: 'https://jenkins.acme.io/job/x/12/' })).toMatchObject({ id: 'jenkins', name: 'Jenkins', partition: 'persist:ci' });
    expect(ciProvider({ repo: 'o/r', url: 'https://app.circleci.com/pipelines/1' })).toMatchObject({ id: 'other', name: 'app.circleci.com' });
    expect(ciProvider({ repo: 'o/r', url: '' })).toMatchObject({ id: 'other', name: 'CI' });
    expect(externalLabel({ repo: 'o/r', url: 'https://jenkins.acme.io/job/x' })).toBe('Open in Jenkins');
    expect(externalLabel({ repo: 'o/r', runId: '1', url: 'https://github.com/o/r/actions/runs/1' })).toBe('Open in GitHub Actions');
    expect(externalLabel({ repo: 'o/r', url: 'https://buildkite.com/x/1' })).toBe('Open details');
  });
  it('rerun mode: gh for Actions runs, the CI page otherwise', () => {
    expect(rerunMode(withData(seed('b-1838'), { runId: '123', repo: 'o/r' }).data)).toBe('actions');
    expect(rerunMode(seed('b-1838').data)).toBe('external');
    expect(rerunMode(withData(seed('b-1838'), { url: '' }).data)).toBe('none');
    expect(rerunBlocked(withData(seed('b-1842'), { runId: '5' }).data)).toBe('Still running');
    expect(rerunBlocked(seed('b-1842').data)).toBeUndefined(); // Jenkins: opens the page
    expect(rerunBlocked(withData(seed('b-1838'), { url: '' }).data)).toMatch(/No run id/);
  });
  it('actions: labels follow the CI, no placeholders, View details opens the sidebar', () => {
    const jenkins = actions(seed('b-1838'));
    expect(jenkins.find((a) => a.id === 'open')?.label).toBe('Open in Jenkins');
    expect(jenkins.find((a) => a.id === 'rerun')).toMatchObject({ type: 'external', label: 'Re-run (on CI page)' });
    const gh = actions(withData(seed('b-1838'), { runId: '7', repo: 'o/r', url: 'https://github.com/o/r/actions/runs/7' }));
    expect(gh.find((a) => a.id === 'open')?.label).toBe('Open in GitHub Actions');
    expect(gh.find((a) => a.id === 'rerun')).toMatchObject({ type: 'direct', label: 'Re-run…' });
    expect(gh.find((a) => a.id === 'details')?.type).toBe('view');
  });
});

describe('build: run → data', () => {
  it('maps a completed, failed run', () => {
    expect(runPatch(run())).toMatchObject({ state: 'completed', conclusion: 'failure', number: 41, stage: 'test', durationSec: 90, trigger: 'pull_request' });
  });
  it('maps a running run (no conclusion, stage = running job, no duration)', () => {
    const p = runPatch(run({ status: 'in_progress', conclusion: '', jobs: [{ databaseId: 3, name: 'e2e', status: 'in_progress', conclusion: '', startedAt: '', completedAt: '', url: '' }] }));
    expect(p).toMatchObject({ state: 'in_progress', conclusion: undefined, stage: 'e2e' });
    expect(p.durationSec).toBeUndefined();
    expect(stageOf(run({ jobs: [] }))).toBeUndefined();
  });
  it('diffPatch keeps only changes and never blanks url / branch', () => {
    const prev = seed('b-1838').data;
    expect(diffPatch(prev, { state: 'completed', conclusion: 'failure', url: undefined })).toEqual({});
    expect(diffPatch(prev, { conclusion: 'success' })).toEqual({ conclusion: 'success' });
  });
  it('duration text', () => {
    expect(duration(undefined)).toBe('–');
    expect(duration(42)).toBe('42s');
    expect(duration(880)).toBe('14m 40s');
  });
});
