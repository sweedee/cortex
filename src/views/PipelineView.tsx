import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { ExternalLink, Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { AiIcon, PlayIcon, RefreshIcon, WorkflowIcon } from '@dynatrace/strato-icons';
import type { Pipeline, PipelineStage } from '../model/types';
import { launchAgent, runPipeline } from '../state/actions';
import { useWork } from '../state/store';
import { StatusIcon, statusColor } from './pipeline/bits';
import { pipelineCss } from './pipeline/styles';
import { formatDuration, relativeTime, useNow } from './ticket/time';

const ERR = /\b(error|failed|failure|exception|fatal)\b|✕|✖|\bFAIL\b|npm ERR!/i;
const WARN = /\bwarn(ing)?\b/i;

export function PipelineView({ workId }: { workId: string }) {
  return <PipelinePage key={workId} workId={workId} />;
}

function defaultStage(p: Pipeline): number {
  const failed = p.stages.findIndex((s) => s.status === 'failed');
  if (failed >= 0) return failed;
  const running = p.stages.findIndex((s) => s.status === 'running');
  if (running >= 0) return running;
  return Math.max(0, p.stages.length - 1);
}

const totalDuration = (p: Pipeline, now: number) =>
  p.status === 'running' || p.status === 'queued'
    ? (now - new Date(p.startedAt).getTime()) / 1000
    : p.stages.reduce((n, s) => n + (s.durationSec ?? 0), 0);

function StageLog({ stage }: { stage: PipelineStage }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => stage.log.replace(/\n$/, '').split('\n'), [stage.log]);
  useEffect(() => {
    if (stage.status === 'running' && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [stage.status, lines.length]);
  if (stage.status === 'queued')
    return (
      <div className="ctx-pl__empty">
        <StatusIcon status="queued" />
        <Text>Queued - waiting for earlier stages to finish</Text>
      </div>
    );
  if (stage.status === 'skipped')
    return (
      <div className="ctx-pl__empty">
        <Text>This stage was skipped because an earlier stage failed</Text>
      </div>
    );
  return (
    <div className="ctx-pl__log" ref={ref} tabIndex={0} role="log" aria-label={`Console output of ${stage.name}`}>
      {lines.map((l, i) => {
        const err = ERR.test(l);
        return (
          <div className="ctx-pl__line" key={i} data-err={err} data-warn={!err && WARN.test(l)}>
            <span className="ctx-pl__no">{i + 1}</span>
            <span>{l || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

function PipelinePage({ workId }: { workId: string }) {
  const work = useWork(workId);
  const now = useNow(1_000);
  const [picked, setPicked] = useState<number | null>(null);
  const pipeline = work?.pipeline;
  const buildNo = pipeline?.buildNumber;
  // A new build resets the manual choice so we follow it again.
  useEffect(() => setPicked(null), [buildNo]);

  if (!work) return null;

  if (!pipeline) {
    const canRun = !!(work.worktree || work.pr);
    return (
      <div className="ctx-pl">
        <style>{pipelineCss}</style>
        <div className="ctx-pl__detail">
          <div className="ctx-pl__empty">
            <WorkflowIcon style={{ width: 32, height: 32 }} />
            <Text textStyle="base-emphasized" style={{ color: Colors.Text.Neutral.Default }}>
              No build yet
            </Text>
            <Text>
              {canRun
                ? `Run the Jenkins pipeline for ${work.worktree?.branch ?? work.pr?.sourceBranch}.`
                : 'Create a worktree or open a pull request to get a build for this work.'}
            </Text>
            {canRun && (
              <Button variant="accent" color="primary" onClick={() => void runPipeline(workId)}>
                <Button.Prefix>
                  <PlayIcon />
                </Button.Prefix>
                Run build
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const sel = Math.min(picked ?? defaultStage(pipeline), pipeline.stages.length - 1);
  const stage = pipeline.stages[sel] as (typeof pipeline.stages)[number] | undefined;
  const running = pipeline.status === 'running' || pipeline.status === 'queued';
  const failed = pipeline.status === 'failed';
  const total = totalDuration(pipeline, now);

  return (
    <div className="ctx-pl">
      <style>{pipelineCss}</style>
      <div>
        <div className="ctx-pl__head">
          <StatusIcon status={pipeline.status} />
          <Text textStyle="base-emphasized">
            {pipeline.job} <span className="ctx-pl__mono">#{pipeline.buildNumber}</span>
          </Text>
          <Text style={{ color: statusColor(pipeline.status), textTransform: 'capitalize' }}>{pipeline.status}</Text>
          <span style={{ flex: 1 }} />
          {failed && (
            <Button variant="accent" color="primary" onClick={() => launchAgent(workId, 'fix-ci')}>
              <Button.Prefix>
                <AiIcon />
              </Button.Prefix>
              Let Claude fix it
            </Button>
          )}
          <Button disabled={running} onClick={() => void runPipeline(workId)}>
            <Button.Prefix>
              <RefreshIcon />
            </Button.Prefix>
            Re-run
          </Button>
        </div>
        <div className="ctx-pl__facts" style={{ marginTop: 6 }}>
          <span>
            Branch <b className="ctx-pl__mono">{pipeline.branch}</b>
          </span>
          <span>
            Commit <b className="ctx-pl__mono">{pipeline.commit.slice(0, 8)}</b>
          </span>
          <span>
            Triggered by <b>{pipeline.triggeredBy}</b>
          </span>
          <span>
            Started <b>{relativeTime(pipeline.startedAt, now)}</b>
          </span>
          {pipeline.url && (
            <span>
              <ExternalLink href={pipeline.url}>Jenkins</ExternalLink>
            </span>
          )}
          <span>
            Duration <b>{running ? `${formatDuration(total)} so far` : formatDuration(total)}</b>
          </span>
        </div>
      </div>

      {pipeline.stages.length === 0 && (
        // "checks only" level: the CI service knows the status (e.g. from gh pr checks) but not the stages
        <div className="ctx-pl__detail" style={{ padding: 16 }}>
          <Text>Stage details and logs are not available for this build.</Text>{' '}
          {pipeline.url && <ExternalLink href={pipeline.url}>Open it in Jenkins</ExternalLink>}
        </div>
      )}

      {stage && (<>
      <div className="ctx-pl__flow" role="group" aria-label="Pipeline stages">
        {pipeline.stages.map((s, i) => (
          <Fragment key={s.name}>
            {i > 0 && <span className="ctx-pl__conn" data-done={pipeline.stages[i - 1].status === 'passed'} />}
            <button
              type="button"
              className="ctx-pl__step"
              data-status={s.status}
              aria-pressed={i === sel}
              onClick={() => setPicked(i)}
            >
              <span className="ctx-pl__step-top">
                <StatusIcon status={s.status} />
                <span className="ctx-pl__step-name" title={s.name}>
                  {s.name}
                </span>
              </span>
              <span className="ctx-pl__step-sub">
                {s.status === 'running'
                  ? 'running…'
                  : s.status === 'queued'
                    ? 'queued'
                    : s.status === 'skipped'
                      ? 'skipped'
                      : formatDuration(s.durationSec ?? 0)}
              </span>
            </button>
          </Fragment>
        ))}
      </div>

      <div className="ctx-pl__detail">
        <div className="ctx-pl__detail-head">
          <StatusIcon status={stage.status} />
          <Text textStyle="base-emphasized">{stage.name}</Text>
          {stage.status === 'running' && <span className="ctx-pl__live">Live</span>}
          {stage.tests && (
            <span className="ctx-pl__tests">
              <span style={{ color: Colors.Text.Success.Default }}>{stage.tests.passed} passed</span>
              <span style={{ color: stage.tests.failed ? Colors.Text.Critical.Default : Colors.Text.Neutral.Subdued }}>
                {stage.tests.failed} failed
              </span>
              <span style={{ color: Colors.Text.Neutral.Subdued }}>{stage.tests.skipped} skipped</span>
            </span>
          )}
        </div>
        <StageLog stage={stage} />
      </div>
      </>)}

      {pipeline.history.length > 0 && (
        <div className="ctx-pl__hist" aria-label="Build history">
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, flex: 'none' }}>
            Previous builds
          </Text>
          {pipeline.history.map((h) => (
            <span className="ctx-pl__hist-item" key={h.buildNumber}>
              <StatusIcon status={h.status} />
              <span className="ctx-pl__mono">#{h.buildNumber}</span>
              <span style={{ color: Colors.Text.Neutral.Subdued }}>{formatDuration(h.durationSec)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
