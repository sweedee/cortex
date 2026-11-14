/**
 * Test run sidebar: command, directory, state, counts, duration, the failing tests (parsed
 * from the output) and the live log (`useTestLog`, appended by live sync; follows the end).
 */
import { useEffect, useMemo, useState } from 'react';
import { Chip, ProgressCircle } from '@dynatrace/strato-components/content';
import { LogView } from '../../components/viewers';
import { useTestLog } from '../../data/tests';
import { isRealPath, type ItemOf } from '../../domain';
import { isDesktop } from '../../native';
import { ConnectionsSection, SidebarSection, SummarySection } from '../../sidebar';
import { inspect, insertSkill, select } from '../../store';
import { errorText } from '../../ui/task';
import type { SidebarProps } from '../types';
import { failingTests } from './failures';
import { durationText } from './logic';
import './testrun.css';

type TestRun = ItemOf<'testrun'>;

const STATE_CHIP = {
  idle: { label: 'Not run yet', color: 'neutral' },
  running: { label: 'Running', color: 'primary' },
  passed: { label: 'Passed', color: 'success' },
  failed: { label: 'Failed', color: 'critical' },
  stopped: { label: 'Stopped', color: 'neutral' },
} as const;

/** Re-render every second while running (live duration). */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

export function TestRunSidebar({ item, ctx }: SidebarProps<'testrun'>) {
  const d = item.data;
  const running = d.state === 'running';
  useTick(running);
  // only runs started from Cortex have a log in main (the item id is the runner id)
  const live = isDesktop && !!d.procId;
  const q = useTestLog(live ? d.procId : undefined);
  const text = q.data || d.outputTail || '';
  const failures = useMemo(() => failingTests(text), [text]);
  const wt = ctx.getAs(d.worktreeId, 'worktree');
  const st = STATE_CHIP[d.state];

  return (
    <>
      <SummarySection item={item} ctx={ctx} />
      <SidebarSection label="Run">
        <div className="tr-chips">
          <Chip size="condensed" color={st.color} variant={d.state === 'idle' || d.state === 'stopped' ? undefined : 'emphasized'}>
            {st.label}
          </Chip>
          {d.summary && (
            <>
              <Chip size="condensed" color="success">
                {d.summary.passed} passed
              </Chip>
              <Chip size="condensed" color={d.summary.failed ? 'critical' : 'neutral'} variant={d.summary.failed ? 'emphasized' : undefined}>
                {d.summary.failed} failed
              </Chip>
              <Chip size="condensed" color="neutral">
                {d.summary.skipped} skipped
              </Chip>
            </>
          )}
        </div>
        <dl className="sidebar-facts tr-facts">
          <div className="tr-span">
            <dt>Command</dt>
            <dd className="tr-mono">{d.command}</dd>
          </div>
          <div className="tr-span">
            <dt>Directory</dt>
            <dd className="tr-mono">{d.cwd}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{durationText(d)}</dd>
          </div>
          <div>
            <dt>Worktree</dt>
            <dd>
              {wt ? (
                <button
                  className="tr-link"
                  onClick={() => {
                    inspect(wt.id);
                    select([wt.id]);
                  }}
                >
                  {wt.handle}
                </button>
              ) : (
                '–'
              )}
            </dd>
          </div>
        </dl>
        {!isRealPath(d.cwd) && <div className="tr-state">Demo data: the directory does not exist on this machine, so it can't be re-run.</div>}
      </SidebarSection>
      {failures.length > 0 && <Failures run={item} names={failures} />}
      <SidebarSection label={running ? 'Output (live)' : 'Output'}>
        {live && q.isLoading ? (
          <div className="tr-state">
            <ProgressCircle size="small" aria-label="Loading the output" /> Loading the output…
          </div>
        ) : live && q.isError ? (
          <div className="tr-state is-error" role="alert">
            Could not load the output: {errorText(q.error)}
          </div>
        ) : text ? (
          <div className="tr-log">
            <LogView text={text} follow aria-label={`Output of ${d.command}`} />
          </div>
        ) : (
          <div className="tr-state">{running ? 'Waiting for output…' : 'No output kept for this run.'}</div>
        )}
        {!q.data && d.outputTail && <div className="tr-state">Showing the last lines kept with the bubble.</div>}
      </SidebarSection>
      <ConnectionsSection item={item} ctx={ctx} />
    </>
  );
}

function Failures({ run, names }: { run: TestRun; names: string[] }) {
  return (
    <SidebarSection
      label={`Failing tests · ${names.length}`}
      actions={
        <button className="tr-link" onClick={() => insertSkill('fix-tests', [run.id])}>
          Fix with Claude
        </button>
      }
    >
      <ul className="tr-failures">
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </SidebarSection>
  );
}
