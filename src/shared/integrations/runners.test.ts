import { describe, expect, it } from 'vitest';
import { detectLocalUrl, parseTestSummary } from './runners';

describe('detectLocalUrl', () => {
  it.each([
    ['  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m', 'http://localhost:5173/'],
    ['ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000', 'http://localhost:3000'],
    ['Listening on http://127.0.0.1:8080/api.', 'http://127.0.0.1:8080/api'],
    ['Server at http://[::1]:4000', 'http://localhost:4000'],
    ['see https://example.com:443/docs', undefined],
    ['no url here', undefined],
  ])('%j → %s', (text, url) => expect(detectLocalUrl(text)).toBe(url));
});

describe('parseTestSummary', () => {
  it('vitest', () => {
    const out = ' Test Files  1 failed | 3 passed (4)\n      Tests  \x1b[31m1 failed\x1b[39m | 40 passed | 2 skipped (43)\n   Start at  10:00:00';
    expect(parseTestSummary(out)).toEqual({ framework: 'vitest', passed: 40, failed: 1, skipped: 2, total: 43 });
    expect(parseTestSummary('      Tests  5 passed (5)')).toEqual({ framework: 'vitest', passed: 5, failed: 0, skipped: 0, total: 5 });
  });
  it('jest', () => {
    expect(parseTestSummary('Test Suites: 1 failed, 2 passed, 3 total\nTests:       1 failed, 2 skipped, 10 passed, 13 total\nSnapshots:   0 total')).toEqual({
      framework: 'jest',
      passed: 10,
      failed: 1,
      skipped: 2,
      total: 13,
    });
  });
  it('pytest', () => {
    expect(parseTestSummary('...\n========= 3 failed, 10 passed, 1 skipped in 0.12s =========')).toEqual({ framework: 'pytest', passed: 10, failed: 3, skipped: 1, total: 14 });
    expect(parseTestSummary('============================== 5 passed in 0.10s ==============================')).toMatchObject({ passed: 5, failed: 0 });
  });
  it('go test', () => {
    expect(parseTestSummary('=== RUN   TestA\n--- PASS: TestA (0.00s)\n=== RUN   TestB\n--- FAIL: TestB (0.01s)\nFAIL\nFAIL\tpkg\t0.02s')).toEqual({
      framework: 'go',
      passed: 1,
      failed: 1,
      skipped: 0,
      total: 2,
    });
    expect(parseTestSummary('ok  \tgithub.com/x/a\t0.012s\nFAIL\tgithub.com/x/b\t0.3s')).toEqual({ framework: 'go', passed: 1, failed: 1, skipped: 0, total: 2 });
  });
  it('mocha and tap / node --test', () => {
    expect(parseTestSummary('  5 passing (20ms)\n  1 pending\n  2 failing')).toEqual({ framework: 'mocha', passed: 5, failed: 2, skipped: 1, total: 8 });
    expect(parseTestSummary('ℹ tests 4\nℹ suites 0\nℹ pass 3\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0')).toEqual({ framework: 'tap', passed: 3, failed: 1, skipped: 0, total: 4 });
    expect(parseTestSummary('# tests 2\n# pass 2\n# fail 0')).toMatchObject({ framework: 'tap', passed: 2, total: 2 });
  });
  it('unknown output', () => expect(parseTestSummary('built in 2s')).toBeUndefined());
});
