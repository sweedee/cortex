import { CycleIcon, DescriptionIcon, StopIcon } from '@dynatrace/strato-icons';
import { testOps } from '../../data/tests';
import type { ItemOf } from '../../domain';
import { inspect, patchData } from '../../store';
import { runTask } from '../../ui/task';
import { paren, skill, toast } from '../common';
import { FlaskIcon } from '../icons';
import type { KindModule } from '../types';
import { rerunBlocked, runRequest, startPatch, stopBlocked, testrunRing } from './logic';
import { testrunLive } from './live';
import { TestRunSidebar } from './Sidebar';

export { testrunRing } from './logic';

type TestRun = ItemOf<'testrun'>;

/** Re-run with the same command and directory; the item id is the runner id (`data.procId`). */
export async function rerunTests(t: TestRun) {
  const prev = { ...t.data };
  patchData<'testrun'>(t, startPatch(t), { notice: undefined });
  const ok = await runTask(`Running ${t.data.command}`, testOps.run(runRequest(t)), { quiet: true });
  // could not start (bad cwd, spawn error): put the old state back
  if (!ok) patchData<'testrun'>(t.id, { ...prev, procId: prev.procId });
}

export async function stopTests(t: TestRun) {
  const id = t.data.procId ?? t.id;
  const stopped = await runTask('Stopping tests', testOps.stop(id), { quiet: true });
  if (stopped === false) {
    // main does not run it (any more): reflect that
    patchData<'testrun'>(t, { state: 'stopped' });
    toast('The run had already ended', t.title, 'info');
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

  describe: ({ data: d }) => {
    const s = d.summary;
    return `test run \`${d.command}\`${paren([d.cwd && `in ${d.cwd}`, d.state, s && `${s.passed} passed, ${s.failed} failed`])}`;
  },
  cwdOf: (t) => t.data.cwd,
  live: testrunLive,

  actions: ([t]) => {
    const running = t.data.state === 'running';
    return [
      ...(t.data.state === 'failed' ? [skill('fix-tests', 'Fix failing tests', 'fix-tests', { primary: true })] : []),
      running
        ? { id: 'stop', label: 'Stop', type: 'direct', icon: <StopIcon />, danger: true, disabled: stopBlocked(t.data), run: () => void stopTests(t) }
        : { id: 'rerun', label: 'Re-run', type: 'direct', icon: <CycleIcon />, primary: t.data.state !== 'failed', disabled: rerunBlocked(t.data), run: () => void rerunTests(t) },
      { id: 'details', label: 'View output', type: 'view', icon: <DescriptionIcon />, primary: running, run: () => inspect(t.id) },
    ];
  },

  Sidebar: TestRunSidebar,
};
