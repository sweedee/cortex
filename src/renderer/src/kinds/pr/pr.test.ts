import { describe, expect, it } from 'vitest';
import type { GhCheck } from '../../../../shared/integrations/github';
import type { ItemOf, PrData } from '../../domain';
import { SEED_ITEMS, SEED_LINKS } from '../../testing/fakeWorld';
import { makeItem } from '../../store';
import { makeCtx } from '../registry';
import { buildKey, checkToBuild, planBuildSync, runIdFromUrl } from './builds';
import { pr as prKind } from './index';
import { ghBlocked, isMergeable, mergeArgs, mergeBlocked, mergeWarnings, needsRetarget, prRing, retargetPlan, stackChildren, worktreeOf } from './logic';

const seed = (id: string) => SEED_ITEMS.find((i) => i.id === id) as ItemOf<'pr'>;
const withData = (p: ItemOf<'pr'>, d: Partial<PrData>): ItemOf<'pr'> => ({ ...p, data: { ...p.data, ...d } });
const real = (p: ItemOf<'pr'>, d: Partial<PrData> = {}) => withData(p, { repo: 'octo/repo', ...d });
const ctx = makeCtx(SEED_ITEMS, SEED_LINKS);
const action = (p: ItemOf<'pr'>, id: string) => prKind.actions([p], ctx).find((a) => a.id === id)!;

describe('pr ring', () => {
  it('approved but conflicting is a split ring (approved + conflict)', () => {
    const p = withData(seed('pr-469'), { mergeable: 'CONFLICTING', checks: { state: 'success' } });
    expect(prRing(p).map((s) => [s.tone, s.label.split(' ')[0]])).toEqual([
      ['success', 'Approved'],
      ['warning', 'Merge'],
    ]);
  });
  it('no checks at all does not block "mergeable"', () => {
    const p = withData(seed('pr-469'), { checks: { state: 'none' } });
    expect(isMergeable(p)).toBe(true);
    expect(prRing(p)).toHaveLength(1);
  });
  it('mergeStateStatus DIRTY counts as conflicting', () => {
    const p = withData(seed('pr-469'), { mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY', checks: { state: 'success' } });
    expect(isMergeable(p)).toBe(false);
    expect(prRing(p).some((s) => s.label === 'Merge conflict')).toBe(true);
    expect(action(real(p), 'rebase')).toMatchObject({ type: 'skill', skill: 'rebase' });
  });
  it('draft wins over the review state, like summarizePr', () => {
    expect(prRing(withData(seed('pr-469'), { isDraft: true }))[0]).toMatchObject({ tone: 'neutral', label: 'Draft' });
  });
});

describe('pr actions', () => {
  it('demo repos (unknown/…) block gh actions; real ones allow them', () => {
    const demo = withData(seed('pr-477'), { repo: 'unknown/x' });
    expect(action(demo, 'merge').disabled).toMatch(/GitHub/);
    expect(action(demo, 'ai-review').disabled).toBeTruthy();
    const ok = real(seed('pr-477'));
    expect(action(ok, 'merge').disabled).toBeUndefined();
    expect(action(ok, 'ai-review').disabled).toBeUndefined();
  });
  it('merge: disabled for drafts and closed / merged PRs, primary only when mergeable', () => {
    expect(mergeBlocked(real(seed('pr-482')).data)).toMatch(/Draft/);
    expect(mergeBlocked(real(seed('pr-469'), { state: 'merged' }).data)).toMatch(/merged/);
    expect(action(real(seed('pr-469')), 'merge').primary).toBe(true);
    expect(action(real(seed('pr-477')), 'merge').primary).toBe(false);
  });
  it('rebase becomes the AI path when conflicts are known', () => {
    const conflicted = action(real(seed('pr-477'), { mergeable: 'CONFLICTING' }), 'rebase');
    expect(conflicted).toMatchObject({ type: 'skill', skill: 'rebase', primary: true });
    expect(action(real(seed('pr-469')), 'rebase')).toMatchObject({ type: 'direct' });
  });
  it('a child of a merged parent gets "Retarget onto <base>" (primary)', () => {
    const parent = makeItem({ id: 'pr-parent', kind: 'pr', handle: 'PR-1', title: 'parent', data: { repo: 'octo/repo', number: 1, headBranch: 'feat/a', baseBranch: 'main', state: 'merged', isDraft: false } }) as ItemOf<'pr'>;
    const child = makeItem({ id: 'pr-child', kind: 'pr', handle: 'PR-2', title: 'child', data: { repo: 'octo/repo', number: 2, headBranch: 'feat/b', baseBranch: 'feat/a', state: 'open', isDraft: false, stackedOn: 'pr-parent' } }) as ItemOf<'pr'>;
    const c = makeCtx([parent, child], []);
    const acts = prKind.actions([child], c);
    expect(acts[0]).toMatchObject({ id: 'retarget', label: 'Retarget onto main', primary: true });
    const retargeted = { ...child, data: { ...child.data, baseBranch: 'main' } };
    expect(prKind.actions([retargeted], makeCtx([parent, retargeted], [])).some((a) => a.id === 'retarget')).toBe(false);
  });
  it('no placeholders left', () => {
    for (const id of ['pr-482', 'pr-477', 'pr-469']) for (const a of prKind.actions([real(seed(id))], ctx)) expect(a.run.toString()).not.toMatch(/not implemented/);
  });
  it('gh blocked reasons', () => {
    expect(ghBlocked(real(seed('pr-477')).data)).toBeUndefined();
    expect(ghBlocked(real(seed('pr-477'), { state: 'closed' }).data)).toBe('PR is closed');
  });
});

describe('merge form', () => {
  it('warns about failing checks, missing approval and conflicts', () => {
    expect(mergeWarnings(seed('pr-477').data)).toEqual(expect.arrayContaining([expect.stringMatching(/failing/), expect.stringMatching(/conflicts/)]));
    expect(mergeWarnings(seed('pr-469').data)).toEqual([]);
    expect(mergeWarnings({ ...seed('pr-469').data, reviewDecision: 'REVIEW_REQUIRED', checks: { state: 'pending' } })).toEqual(['checks are still running', 'it is not approved']);
  });
  it('values → prMerge arguments (default squash)', () => {
    const d = { repo: 'o/r', number: 7 };
    expect(mergeArgs(d, { method: 'rebase', deleteBranch: true })).toEqual(['o/r', 7, 'rebase', { deleteBranch: true }]);
    expect(mergeArgs(d, { method: 'bogus', deleteBranch: false })).toEqual(['o/r', 7, 'squash', { deleteBranch: false }]);
    expect(mergeArgs(d, {})).toEqual(['o/r', 7, 'squash', { deleteBranch: false }]);
  });
});

describe('stacked PRs', () => {
  it('finds open children and plans the retarget', () => {
    const parent = seed('pr-482');
    const kids = stackChildren(SEED_ITEMS, parent.id);
    expect(kids.map((k) => k.id)).toEqual(['pr-3124']);
    expect(retargetPlan(parent.data, kids, true)).toEqual([{ child: kids[0], newBase: 'main', automatic: true }]);
    expect(retargetPlan(parent.data, kids, false)[0].automatic).toBe(false);
    // a child already retargeted elsewhere is left alone
    expect(retargetPlan(parent.data, [withData(kids[0], { baseBranch: 'develop' })], true)).toEqual([]);
  });
  it('needsRetarget once the parent merged', () => {
    const parent = seed('pr-482').data;
    const child = seed('pr-3124').data;
    expect(needsRetarget(child, parent)).toBe(false);
    expect(needsRetarget(child, { ...parent, state: 'merged' })).toBe(true);
    expect(needsRetarget({ ...child, baseBranch: 'main' }, { ...parent, state: 'merged' })).toBe(false);
  });
  it('worktreeOf prefers a linked worktree, then the head branch', () => {
    const p = seed('pr-482');
    const linked = ctx.linked(p.id, 'worktree');
    expect(worktreeOf(p, linked, [])?.id).toBe('w-4821');
    const inProj = ctx.inProject('p-ingest', 'worktree');
    expect(worktreeOf(p, [], inProj)?.data.branch).toBe(p.data.headBranch);
    expect(worktreeOf(withData(p, { headBranch: '' }), [], inProj)).toBeUndefined();
  });
});

describe('builds from checks', () => {
  const check = (o: Partial<GhCheck>): GhCheck => ({
    name: 'test',
    state: 'SUCCESS',
    bucket: 'pass',
    link: 'https://github.com/o/r/actions/runs/123/job/456',
    workflow: 'CI',
    description: '',
    event: 'pull_request',
    startedAt: '2026-11-14T10:00:00Z',
    completedAt: '2026-11-14T10:02:05Z',
    ...o,
  });
  const pr = makeItem({ kind: 'pr', handle: 'PR-9', title: 'x', projectId: 'p-ingest', data: { repo: 'o/r', number: 9, headBranch: 'feat/x', baseBranch: 'main', state: 'open', isDraft: false } }) as ItemOf<'pr'>;

  it('maps a check to build data', () => {
    expect(runIdFromUrl('https://github.com/o/r/actions/runs/123/job/456')).toBe('123');
    expect(runIdFromUrl('https://ci.example/job/x/12')).toBeUndefined();
    expect(checkToBuild(check({}), pr.data)).toMatchObject({ repo: 'o/r', name: 'test', runId: '123', state: 'completed', conclusion: 'success', prNumber: 9, branch: 'feat/x', stage: 'CI', trigger: 'pull_request', durationSec: 125 });
    expect(checkToBuild(check({ bucket: 'pending', state: 'IN_PROGRESS', completedAt: '' }), pr.data)).toMatchObject({ state: 'in_progress' });
    expect(checkToBuild(check({ bucket: 'pending', state: 'QUEUED' }), pr.data).state).toBe('queued');
    expect(checkToBuild(check({ bucket: 'fail', state: 'FAILURE', link: 'https://jenkins.example/job/x/3/' }), pr.data)).toMatchObject({ conclusion: 'failure' });
    expect(checkToBuild(check({ bucket: 'fail', state: 'FAILURE', link: 'https://jenkins.example/job/x/3/' }), pr.data).runId).toBeUndefined();
  });

  it('creates missing builds and updates existing ones (deduped by repo + name + PR)', () => {
    const existing = makeItem({ kind: 'build', handle: 'b', title: 'b', data: { repo: 'o/r', name: 'lint', url: '', state: 'in_progress', prNumber: 9, branch: 'feat/x', stage: 'mine' } });
    const other = makeItem({ kind: 'build', handle: 'c', title: 'c', data: { repo: 'o/r', name: 'test', url: '', state: 'completed', prNumber: 8, branch: 'x' } });
    const plan = planBuildSync([pr, existing, other], pr, [check({ name: 'lint', bucket: 'fail', state: 'FAILURE' }), check({ name: 'test' }), check({ name: 'test' }), check({ name: 'triage', bucket: 'skipping', state: 'SKIPPED' })]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe(existing.id);
    expect(plan.updates[0].patch).toMatchObject({ state: 'completed', conclusion: 'failure' });
    expect(plan.updates[0].patch.stage).toBeUndefined();
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({ kind: 'build', projectId: 'p-ingest', data: { name: 'test', prNumber: 9 } });
    expect(buildKey('o/r', 'test', 9)).not.toBe(buildKey('o/r', 'test', 8));
  });

  it('nothing to do when the bubbles are current', () => {
    const data = checkToBuild(check({}), pr.data);
    const b = makeItem({ kind: 'build', handle: 'b', title: 'b', data });
    expect(planBuildSync([pr, b], pr, [check({})])).toEqual({ updates: [], creates: [] });
  });
});
