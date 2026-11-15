import { describe, expect, it } from 'vitest';
import type { ItemOf, TestRunData } from '../../domain';
import { SEED_ITEMS, SEED_LINKS } from '../../testing/fakeWorld';
import { mapTestState } from '../../sync/mapping';
import { makeCtx } from '../registry';
import { failingTests } from './failures';
import { testrun as kind } from './index';
import { durationText, rerunBlocked, runRequest, startPatch, stopBlocked, testrunRing } from './logic';

const seed = SEED_ITEMS.find((i) => i.id === 'tr-4821') as ItemOf<'testrun'>;
const withData = (d: Partial<TestRunData>): ItemOf<'testrun'> => ({ ...seed, data: { ...seed.data, ...d } });
const ctx = makeCtx(SEED_ITEMS, SEED_LINKS);
const ids = (t: ItemOf<'testrun'>) => kind.actions([t], ctx).map((a) => a.id);

describe('failing test names', () => {
  it('vitest (summary + tree, deduped)', () => {
    const out = [
      ' ❯ src/dispatcher/retry.spec.ts (5 tests | 2 failed) 12ms',
      '   ✓ retries 3 times',
      '   × caps the delay at maxDelay 4ms',
      '   × adds jitter within ±20%',
      '⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯',
      ' FAIL  src/dispatcher/retry.spec.ts > retry > caps the delay at maxDelay',
      ' FAIL  src/dispatcher/retry.spec.ts > retry > adds jitter within ±20%',
      '      Tests  2 failed | 3 passed (5)',
    ].join('\n');
    expect(failingTests(out)).toEqual(['src/dispatcher/retry.spec.ts > retry > caps the delay at maxDelay', 'src/dispatcher/retry.spec.ts > retry > adds jitter within ±20%']);
  });
  it('the seed tail', () => {
    expect(failingTests(seed.data.outputTail)).toHaveLength(2);
  });
  it('jest', () => {
    const out = [
      'FAIL src/a.test.js',
      '  math',
      '    ✓ adds (2 ms)',
      '    ✕ divides (5 ms)',
      '',
      '  ● math › divides',
      '',
      '    expect(received).toBe(expected)',
      'Tests:       1 failed, 1 passed, 2 total',
    ].join('\n');
    expect(failingTests(out)).toEqual(['math › divides']);
  });
  it('pytest', () => {
    const out = [
      'tests/test_a.py .F.',
      '=========================== short test summary info ============================',
      'FAILED tests/test_a.py::test_div - ZeroDivisionError: division by zero',
      'ERROR tests/test_b.py::test_db',
      '===== 1 failed, 2 passed, 1 error in 0.12s =====',
    ].join('\n');
    expect(failingTests(out)).toEqual(['tests/test_a.py::test_div', 'tests/test_b.py::test_db']);
  });
  it('go test', () => {
    expect(failingTests('=== RUN   TestX\n--- FAIL: TestX (0.00s)\n--- PASS: TestY (0.00s)\nFAIL')).toEqual(['TestX']);
  });
  it('ANSI colours, nothing recognisable, the cap', () => {
    expect(failingTests('\u001b[31m FAIL \u001b[39m a.ts > b')).toEqual(['a.ts > b']);
    expect(failingTests('all good\n✓ fine')).toEqual([]);
    expect(failingTests(undefined)).toEqual([]);
    expect(failingTests(Array.from({ length: 80 }, (_, i) => `--- FAIL: T${i}`).join('\n'))).toHaveLength(50);
  });
});

describe('test run actions', () => {
  it('rerun needs a real directory and no run in progress; stop only for started runs', () => {
    expect(rerunBlocked(seed.data)).toMatch(/demo/);
    expect(rerunBlocked(withData({ cwd: 'C:\\code\\x' }).data)).toBeUndefined();
    expect(rerunBlocked(withData({ cwd: '/home/x', state: 'running' }).data)).toBe('Already running');
    expect(stopBlocked(withData({ state: 'running' }).data)).toMatch(/demo/);
    expect(stopBlocked(withData({ state: 'running', procId: seed.id }).data)).toBeUndefined();
    expect(stopBlocked(seed.data)).toBe('Not running');
  });
  it('offers stop while running, rerun otherwise', () => {
    expect(ids(withData({ state: 'running', procId: seed.id }))).toEqual(['stop', 'details']);
    expect(ids(seed)).toEqual(['fix-tests', 'rerun', 'details']);
    expect(ids(withData({ state: 'passed' }))).toEqual(['rerun', 'details']);
  });
  it('rerun request = same command / cwd, item id as runner id', () => {
    expect(runRequest(seed)).toEqual({ id: 'tr-4821', cwd: seed.data.cwd, command: 'npm test' });
    expect(startPatch(seed, 5)).toEqual({ state: 'running', procId: 'tr-4821', summary: undefined, outputTail: undefined, startedAt: 5, endedAt: undefined });
  });
  it('live sync on an item created by the worktree kind (procId = item id) drives the ring', () => {
    const t = withData({ state: 'running', procId: seed.id, summary: undefined });
    const m = mapTestState(
      { id: seed.id, cwd: '/x', command: 'npm test', status: 'failed', startedAt: 1, finishedAt: 2, summary: { framework: 'vitest', passed: 3, failed: 1, skipped: 0, total: 4 } },
      t.data,
    );
    const next = withData({ ...t.data, ...m.patch });
    expect(testrunRing(next).map((s) => s.tone)).toEqual(['critical', 'success']);
    expect(m.notice?.tone).toBe('critical');
  });
  it('a failed run without failing tests still looks failed', () => {
    expect(testrunRing(withData({ summary: { passed: 4, failed: 0, skipped: 0 } }))[0]?.tone).toBe('critical');
  });
  it('duration', () => {
    expect(durationText({ state: 'passed', startedAt: 0, endedAt: 75_000 })).toBe('1m 15s');
    expect(durationText({ state: 'running', startedAt: 0 }, 3_000)).toBe('3s');
    expect(durationText({ state: 'idle' })).toBe('–');
  });
});
