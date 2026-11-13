import { CycleIcon } from '@dynatrace/strato-icons';
import type { ItemOf, Segment } from '../../domain';
import { placeholder, skill } from '../common';
import { FlaskIcon } from '../icons';
import type { KindModule } from '../types';

export function testrunRing({ data }: ItemOf<'testrun'>): Segment[] {
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
      return out.length ? out : [{ tone: 'neutral', label: 'No tests' }];
    }
  }
}

/** One run of a project's / worktree's test command. */
export const testrun: KindModule<'testrun'> = {
  kind: 'testrun',
  label: 'Test run',
  icon: (s) => <FlaskIcon size={s} />,
  radius: 26,
  level: 4,

  ring: testrunRing,
  short: ({ data }) => (data.summary?.failed ? `${data.summary.failed}✗` : undefined),
  subtitle: ({ data }) => data.command,
  facts: ({ data }, ctx) => {
    const wt = ctx.getAs(data.worktreeId, 'worktree');
    const s = data.summary;
    return [
      ['Result', s ? `${s.passed} passed · ${s.failed} failed · ${s.skipped} skipped` : data.state],
      ['Command', data.command],
      ['Directory', data.cwd],
      ...(wt ? [['Worktree', wt.handle] as [string, string]] : []),
    ];
  },

  actions: ([t]) => [
    ...(t.data.state === 'failed' ? [skill('fix-tests', 'Fix failing tests', 'fix-tests', { primary: true })] : []),
    placeholder('rerun', 'Re-run', <CycleIcon />, { primary: t.data.state !== 'failed' }),
  ],
};
