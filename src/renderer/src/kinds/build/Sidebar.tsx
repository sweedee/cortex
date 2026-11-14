/**
 * Build sidebar: Overview (state, branch, PR, trigger, timing, stage, URL; jobs and steps of a
 * GitHub Actions run, polled while it runs) · Details (the CI page in a webview).
 */
import { useEffect } from 'react';
import { Chip, ProgressCircle } from '@dynatrace/strato-components/content';
import { CriticalIcon, MinusIcon, PendingIcon, SuccessIcon } from '@dynatrace/strato-icons';
import type { GhRun, GhRunJob } from '../../../../shared/integrations/github';
import { WebPanel } from '../../components/viewers';
import { useRun } from '../../data/gh';
import type { ItemOf } from '../../domain';
import { isDesktop } from '../../native';
import { ConnectionsSection, SidebarSection, SidebarTabs, SummarySection } from '../../sidebar';
import { getState, inspect, patchData, select } from '../../store';
import { agoText } from '../../tones';
import { errorText, openUrl } from '../../ui/task';
import type { KindCtx, SidebarProps } from '../types';
import { ciProvider, diffPatch, duration, externalLabel, rerunMode, runPatch } from './logic';
import './build.css';

type Build = ItemOf<'build'>;

export function BuildSidebar({ item, ctx }: SidebarProps<'build'>) {
  return (
    <SidebarTabs
      rememberAs="build"
      initial="overview"
      tabs={[
        { id: 'overview', label: 'Overview', render: () => <Overview build={item} ctx={ctx} /> },
        {
          id: 'details',
          label: ciProvider(item.data).id === 'other' ? 'Details' : ciProvider(item.data).name,
          wide: true,
          render: () =>
            item.data.url ? (
              <WebPanel src={/^https?:\/\//i.test(item.data.url) ? item.data.url : `https://${item.data.url}`} partition={ciProvider(item.data).partition} onOpenExternal={(u) => void openUrl(u)} />
            ) : (
              <SidebarSection>
                <div className="build-state">No details URL known for this build.</div>
              </SidebarSection>
            ),
        },
      ]}
    />
  );
}

const STATE_COLOR = { queued: 'neutral', in_progress: 'primary', completed: 'neutral' } as const;
const CONCLUSION_COLOR: Record<string, 'success' | 'critical' | 'neutral' | 'warning'> = { success: 'success', failure: 'critical', timed_out: 'critical', cancelled: 'warning', skipped: 'neutral', neutral: 'neutral' };

function Overview({ build: b, ctx }: { build: Build; ctx: KindCtx }) {
  const d = b.data;
  const actions = rerunMode(d) === 'actions';
  const q = useRun(actions ? d.repo : undefined, actions ? Number(d.runId) : undefined);
  const run = q.data;

  // the run's state back onto the bubble
  useEffect(() => {
    if (!run) return;
    const cur = getState().items.find((i) => i.id === b.id);
    if (cur?.kind !== 'build') return;
    const patch = diffPatch(cur.data, runPatch(run));
    if (Object.keys(patch).length) patchData<'build'>(cur, patch);
  }, [run, b.id]);

  const pr = ctx.items.find((i): i is ItemOf<'pr'> => i.kind === 'pr' && i.data.repo === d.repo && i.data.number === d.prNumber);
  const facts: [string, React.ReactNode][] = [
    ['Name', d.name],
    ['Branch', d.branch || '–'],
    [
      'Pull request',
      pr ? (
        <button key="pr" className="build-link" onClick={() => go(pr.id)}>
          #{pr.data.number}
        </button>
      ) : d.prNumber ? (
        `#${d.prNumber}`
      ) : (
        '–'
      ),
    ],
    ['Trigger', d.trigger ?? '–'],
    ['Started', run?.startedAt ? agoText(Date.parse(run.startedAt)) : '–'],
    ['Duration', duration(d.durationSec)],
    ['Stage', d.stage ?? '–'],
    ['Number', d.number != null ? `#${d.number}${run && run.attempt > 1 ? ` (attempt ${run.attempt})` : ''}` : '–'],
  ];

  return (
    <>
      <SummarySection item={b} ctx={ctx} />
      <SidebarSection label="Build">
        <div className="build-chips">
          <Chip size="condensed" color={STATE_COLOR[d.state]} variant={d.state === 'in_progress' ? 'emphasized' : undefined}>
            {d.state.replace('_', ' ')}
          </Chip>
          {d.conclusion && (
            <Chip size="condensed" color={CONCLUSION_COLOR[d.conclusion]} variant="emphasized">
              {d.conclusion.replace('_', ' ')}
            </Chip>
          )}
          <Chip size="condensed" color="neutral">
            {ciProvider(d).name}
          </Chip>
        </div>
        <dl className="sidebar-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="build-wrap">{v}</dd>
            </div>
          ))}
        </dl>
        {d.url && (
          <div className="build-url">
            <button className="build-link" onClick={() => void openUrl(d.url)} title={externalLabel(d)}>
              {d.url}
            </button>
          </div>
        )}
      </SidebarSection>
      {actions ? (
        <SidebarSection label={run ? `Jobs · ${run.jobs.length}` : 'Jobs'}>
          {!isDesktop ? (
            <div className="build-state">Run details are only available in the desktop app.</div>
          ) : q.isLoading ? (
            <div className="build-state">
              <ProgressCircle size="small" aria-label="Loading the run" /> Loading the run…
            </div>
          ) : q.isError ? (
            <div className="build-state is-error" role="alert">
              Could not load run {d.runId}: {errorText(q.error)}
            </div>
          ) : run ? (
            <Jobs run={run} />
          ) : null}
        </SidebarSection>
      ) : (
        <SidebarSection label="Jobs">
          <div className="build-state">{ciProvider(d).id === 'other' ? 'Jobs and logs of this CI are on its details page (Details tab).' : `${ciProvider(d).name} jobs and logs are on its details page (${ciProvider(d).name} tab).`}</div>
        </SidebarSection>
      )}
      <ConnectionsSection item={b} ctx={ctx} />
    </>
  );
}

const go = (id: string) => {
  inspect(id);
  select([id]);
};

const isBad = (c: string) => c === 'failure' || c === 'timed_out' || c === 'startup_failure';

function StatusIcon({ status, conclusion }: { status: string; conclusion: string }) {
  if (status !== 'completed') return <PendingIcon className="build-tone-running" />;
  if (isBad(conclusion)) return <CriticalIcon className="build-tone-critical" />;
  if (conclusion === 'success') return <SuccessIcon className="build-tone-success" />;
  return <MinusIcon className="build-tone-neutral" />;
}

const jobSecs = (j: GhRunJob) => {
  const a = Date.parse(j.startedAt);
  const b = Date.parse(j.completedAt);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : undefined;
};

function Jobs({ run }: { run: GhRun }) {
  if (!run.jobs.length) return <div className="build-state">No jobs yet.</div>;
  return (
    <div className="build-jobs">
      {run.jobs.map((j) => (
        <div key={j.databaseId} className={`build-job ${isBad(j.conclusion) ? 'is-failed' : ''}`}>
          <button className="sidebar-row" onClick={() => void openUrl(j.url)} title="Open the job log on GitHub">
            <span className="build-icon">
              <StatusIcon status={j.status} conclusion={j.conclusion} />
            </span>
            <span className="sidebar-row-main">{j.name}</span>
            <span className="sidebar-row-rel">{j.status === 'completed' ? duration(jobSecs(j)) : j.status.replace('_', ' ')}</span>
          </button>
          {(j.steps ?? []).length > 0 && (isBad(j.conclusion) || j.status !== 'completed') && (
            <ol className="build-steps">
              {(j.steps ?? []).map((s) => (
                <li key={s.number} className={isBad(s.conclusion) ? 'is-failed' : s.status !== 'completed' ? 'is-running' : ''}>
                  <StatusIcon status={s.status} conclusion={s.conclusion} />
                  <span>{s.name}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
