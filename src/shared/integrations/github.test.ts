import { describe, expect, it } from 'vitest';
import { isRenovatePr, prNumberFromUrl, rollupBuckets, rollupChecks, updateTypeOf, type GhCheck, type GhStatusCheck } from './github';

const run = (status: string, conclusion = ''): GhStatusCheck => ({ __typename: 'CheckRun', name: 'x', status, conclusion }) as GhStatusCheck;

describe('github mappers', () => {
  it('rolls up statusCheckRollup', () => {
    expect(rollupChecks([])).toBe('none');
    expect(rollupChecks([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED')])).toBe('passed');
    expect(rollupChecks([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS')])).toBe('pending');
    expect(rollupChecks([run('IN_PROGRESS'), run('COMPLETED', 'FAILURE')])).toBe('failed');
    expect(rollupChecks([{ __typename: 'StatusContext', context: 'jenkins', state: 'ERROR' }])).toBe('failed');
  });

  it('rolls up gh pr checks buckets', () => {
    const c = (bucket: GhCheck['bucket']) => ({ bucket }) as GhCheck;
    expect(rollupBuckets([c('pass'), c('skipping')])).toBe('passed');
    expect(rollupBuckets([c('pass'), c('pending')])).toBe('pending');
    expect(rollupBuckets([c('cancel'), c('pending')])).toBe('failed');
  });

  it('classifies Renovate updates', () => {
    expect(updateTypeOf({ title: 'Update dep', headRefName: 'x', labels: [{ name: 'type: minor' }] })).toBe('minor');
    expect(updateTypeOf({ title: 'Update dep', headRefName: 'renovate/patch-lodash', labels: [] })).toBe('patch');
    expect(updateTypeOf({ title: 'Update react monorepo to v19', headRefName: 'renovate/react', labels: [] })).toBe('major');
    expect(updateTypeOf({ title: 'Update actions/checkout digest to 1a2b3c4', headRefName: 'renovate/x', labels: [] })).toBe('digest');
    expect(isRenovatePr({ author: { login: 'app/renovate' }, labels: [], headRefName: 'x' })).toBe(true);
    expect(isRenovatePr({ author: { login: 'me' }, labels: [], headRefName: 'feat/x' })).toBe(false);
  });

  it('finds the PR URL in gh pr create output', () => {
    expect(prNumberFromUrl('Warning: 1 uncommitted change\nhttps://github.com/o/r/pull/12\n')).toEqual({ number: 12, url: 'https://github.com/o/r/pull/12' });
    expect(prNumberFromUrl('nothing')).toBeNull();
  });
});
