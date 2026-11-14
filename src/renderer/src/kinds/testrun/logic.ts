/** Pure test run helpers: ring, rerun / stop availability, the runner request. */
import type { TestRunRequest } from '../../../../shared/integrations/runners';
import { isRealPath, type ItemOf, type Segment, type TestRunData } from '../../domain';

type TestRun = ItemOf<'testrun'>;

export function testrunRing({ data }: TestRun): Segment[] {
  const s = data.summary;
  switch (data.state) {
    case 'running':
      return [{ tone: 'running', label: 'Running' }];
    case 'idle':
      return [{ tone: 'neutral', label: 'Not run yet' }];
    case 'stopped':
      return [{ tone: 'neutral', label: 'Stopped' }];
    case 'passed':
    case 'failed': {
      if (!s) return [{ tone: data.state === 'passed' ? 'success' : 'critical', label: data.state === 'passed' ? 'Passed' : 'Failed' }];
      const out: Segment[] = [];
      if (s.failed) out.push({ tone: 'critical', label: `${s.failed} failed`, weight: Math.max(s.failed, (s.passed + s.failed) * 0.15) });
      if (s.passed) out.push({ tone: 'success', label: `${s.passed} passed`, weight: s.passed });
      if (s.skipped) out.push({ tone: 'neutral', label: `${s.skipped} skipped`, weight: Math.max(s.skipped, (s.passed + s.failed) * 0.05) });
      // failed with zero failing tests (e.g. a crash) still has to look failed
      if (data.state === 'failed' && !s.failed) out.unshift({ tone: 'critical', label: 'Failed', weight: Math.max(1, (s.passed + s.skipped) * 0.15) });
      return out.length ? out : [{ tone: 'neutral', label: 'No tests' }];
    }
  }
}

/** Why it can't (re)run: running already, or the directory is demo data. */
export function rerunBlocked(d: TestRunData): string | undefined {
  if (d.state === 'running') return 'Already running';
  if (!d.command.trim()) return 'No test command';
  if (!isRealPath(d.cwd)) return 'Not a real directory (demo data): set the project base checkout in Settings';
  return undefined;
}

/** Stop only what Cortex started (`procId`) and still runs. */
export const stopBlocked = (d: TestRunData): string | undefined => (d.state !== 'running' ? 'Not running' : !d.procId ? 'Not started from Cortex (demo item)' : undefined);

/** The runner request for a (re)run: same command and cwd, the item id as runner id. */
export const runRequest = (t: TestRun): TestRunRequest => ({ id: t.id, cwd: t.data.cwd, command: t.data.command });

/** The patch applied right away when a rerun starts (live sync takes over from there). */
export const startPatch = (t: TestRun, now = Date.now()): Partial<TestRunData> => ({ state: 'running', procId: t.id, summary: undefined, outputTail: undefined, startedAt: now, endedAt: undefined });

export const durationText = (d: Pick<TestRunData, 'startedAt' | 'endedAt' | 'state'>, now = Date.now()) => {
  if (!d.startedAt) return '–';
  const end = d.endedAt ?? (d.state === 'running' ? now : undefined);
  if (!end) return '–';
  const s = Math.max(0, Math.round((end - d.startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
