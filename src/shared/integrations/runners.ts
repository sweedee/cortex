/**
 * Process-backed runners: apps (dev servers) and test runs. Types plus the pure output
 * parsers (local URL detection, test summary). Dependency free.
 */

export type AppStatus = 'starting' | 'running' | 'exited' | 'crashed';

export interface AppStartRequest {
  /** caller-chosen id (e.g. the canvas item id) */
  id: string;
  cwd: string;
  /** the user's configured command line, run through the shell (e.g. `npm run dev`) */
  command: string;
  env?: Record<string, string>;
  /** used as the URL until (or unless) one is detected in the output */
  urlHint?: string;
}

export interface AppState {
  id: string;
  cwd: string;
  command: string;
  status: AppStatus;
  /** detected from the output (`http://localhost:5173/`), else `urlHint` */
  url?: string;
  pid?: number;
  startedAt: number;
  exitedAt?: number;
  code?: number | null;
  error?: string;
}

export interface TestRunRequest {
  id: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
}

export interface TestSummary {
  framework: 'vitest' | 'jest' | 'pytest' | 'go' | 'mocha' | 'tap' | 'unknown';
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export type TestStatus = 'running' | 'passed' | 'failed' | 'error';

export interface TestState {
  id: string;
  cwd: string;
  command: string;
  status: TestStatus;
  summary?: TestSummary;
  pid?: number;
  startedAt: number;
  finishedAt?: number;
  code?: number | null;
  error?: string;
}

/** batched output (main flushes every ~100 ms) */
export interface RunnerOutputEvent {
  id: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

// ---- parsers --------------------------------------------------------------------------

// oxlint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

/** First local URL in a chunk of dev-server output (`0.0.0.0` / `[::]` shown as localhost). */
export function detectLocalUrl(text: string): string | undefined {
  const m = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):\d{2,5}(?:\/[^\s'"<>)]*)?/i.exec(stripAnsi(text));
  return m ? m[0].replace(/0\.0\.0\.0|\[::1?\]|\[::\]/, 'localhost').replace(/[.,;]$/, '') : undefined;
}

const num = (m: RegExpExecArray | null, i = 1) => (m ? Number(m[i]) : 0);

/** Best-effort test summary from a runner's full output; undefined when nothing is recognised. */
export function parseTestSummary(raw: string): TestSummary | undefined {
  const out = stripAnsi(raw);

  // vitest: "      Tests  12 passed | 1 failed | 2 skipped (15)"
  const vt = [...out.matchAll(/^\s*Tests\s+(.+?)\s*\((\d+)\)\s*$/gm)].pop();
  if (vt) {
    const part = vt[1];
    const passed = num(/(\d+) passed/.exec(part));
    const failed = num(/(\d+) failed/.exec(part));
    const skipped = num(/(\d+) skipped/.exec(part)) + num(/(\d+) todo/.exec(part));
    return { framework: 'vitest', passed, failed, skipped, total: Number(vt[2]) };
  }

  // jest: "Tests:       1 failed, 2 skipped, 10 passed, 13 total"
  const jt = [...out.matchAll(/^Tests:\s+(.+?(\d+) total)\s*$/gm)].pop();
  if (jt) {
    const part = jt[1];
    return {
      framework: 'jest',
      passed: num(/(\d+) passed/.exec(part)),
      failed: num(/(\d+) failed/.exec(part)),
      skipped: num(/(\d+) skipped/.exec(part)) + num(/(\d+) todo/.exec(part)),
      total: Number(jt[2]),
    };
  }

  // pytest: "==== 3 failed, 10 passed, 1 skipped in 0.12s ====" (also "5 passed in 0.1s")
  const pt = [...out.matchAll(/^=+ (.*?\d+ (?:passed|failed|error|errors|skipped).*?) in [\d.]+s(?: \([^)]*\))? =+\s*$/gm)].pop();
  if (pt) {
    const part = pt[1];
    const passed = num(/(\d+) passed/.exec(part));
    const failed = num(/(\d+) failed/.exec(part)) + num(/(\d+) errors?/.exec(part));
    const skipped = num(/(\d+) skipped/.exec(part)) + num(/(\d+) xfailed/.exec(part));
    return { framework: 'pytest', passed, failed, skipped, total: passed + failed + skipped };
  }

  // go test (-v): "--- PASS: TestX", "--- FAIL: TestY", "--- SKIP: TestZ"; without -v only package lines
  const goPass = (out.match(/^\s*--- PASS: /gm) ?? []).length;
  const goFail = (out.match(/^\s*--- FAIL: /gm) ?? []).length;
  const goSkip = (out.match(/^\s*--- SKIP: /gm) ?? []).length;
  if (goPass + goFail + goSkip > 0) return { framework: 'go', passed: goPass, failed: goFail, skipped: goSkip, total: goPass + goFail + goSkip };
  const pkgOk = (out.match(/^ok\s+\S+/gm) ?? []).length;
  const pkgFail = (out.match(/^FAIL\s+\S+/gm) ?? []).length;
  if (pkgOk + pkgFail > 0 && /^(ok|FAIL)\s+\S+\s+[\d.]+s/m.test(out)) return { framework: 'go', passed: pkgOk, failed: pkgFail, skipped: 0, total: pkgOk + pkgFail };

  // mocha: "  5 passing (20ms)", "  1 failing", "  2 pending"
  const mp = /^\s*(\d+) passing\b/m.exec(out);
  if (mp) {
    const passed = Number(mp[1]);
    const failed = num(/^\s*(\d+) failing\b/m.exec(out));
    const skipped = num(/^\s*(\d+) pending\b/m.exec(out));
    return { framework: 'mocha', passed, failed, skipped, total: passed + failed + skipped };
  }

  // TAP / node --test: "# pass 5" / "ℹ pass 5", "# fail 1", "# skip 0"
  const tp = /^(?:#|ℹ) pass (\d+)/m.exec(out);
  if (tp) {
    const passed = Number(tp[1]);
    const failed = num(/^(?:#|ℹ) fail (\d+)/m.exec(out));
    const skipped = num(/^(?:#|ℹ) skip(?:ped)? (\d+)/m.exec(out)) + num(/^(?:#|ℹ) todo (\d+)/m.exec(out));
    const total = num(/^(?:#|ℹ) tests (\d+)/m.exec(out)) || passed + failed + skipped;
    return { framework: 'tap', passed, failed, skipped, total };
  }
  return undefined;
}
