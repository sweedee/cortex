import { useEffect, useRef, useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { AiIcon } from '@dynatrace/strato-icons';
import { SessionComposer } from '../../components/session/SessionComposer';
import { StatusChip, StatusDot, cxVars, formatStarted, plural } from '../../components/session/meta';
import { Transcript } from '../../components/session/Transcript';
import { mostRelevantSession, needsInput } from '../../model/session';
import type { CheckState, Project, RenovatePr, UpdateType } from '../../model/types';
import { loadRenovatePrs, reviewRenovatePrs } from '../../state/actions';
import type { Tone } from '../../state/derive';
import { useCortex } from '../../state/store';
import './projects.css';
import '../../shell/shell.css';

const TYPE_COLOR: Record<UpdateType, 'neutral' | 'primary' | 'warning'> = { patch: 'neutral', minor: 'primary', major: 'warning', unknown: 'neutral' };
const CI: Record<CheckState, { label: string; tone: Tone }> = {
  passed: { label: 'passing', tone: 'success' },
  failed: { label: 'failing', tone: 'critical' },
  pending: { label: 'running', tone: 'primary' },
  none: { label: 'no checks', tone: 'neutral' },
};

function PrRow({ pr }: { pr: RenovatePr }) {
  const ci = CI[pr.ci];
  return (
    <div className="cx-pj-dep">
      <Text className="cx-mono cx-tone-neutral">#{pr.number}</Text>
      <Text className="cx-ellipsis" title={pr.title}>
        {pr.title.replace(/^Update dependency /, '')}
      </Text>
      <Chip size="condensed" color={TYPE_COLOR[pr.updateType]}>
        {pr.updateType === 'unknown' ? 'update' : pr.updateType}
      </Chip>
      <Text textStyle="small" className={`cx-tone-${ci.tone} cx-pj-dep-ci`}>
        <span className="cx-dot" aria-hidden />
        {ci.label}
      </Text>
    </div>
  );
}

/**
 * "Dependency updates" of a project: the open Renovate PRs and the agent that reviews them. The agent's
 * session is shown right here (same Transcript and composer as on a work item); earlier runs stay selectable.
 */
export function ProjectDependencies({ project }: { project: Project }) {
  const prs = useCortex((s) => s.renovate[project.id]);
  const sessions = useCortex((s) => s.sessions);
  const [picked, setPicked] = useState<string>();
  const runRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadRenovatePrs(project.id);
  }, [project.id]);

  // a run that was just started (or picked) is what the user wants to see: bring it on screen
  useEffect(() => {
    if (picked) runRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [picked]);

  const runs = sessions.filter((s) => s.projectId === project.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const shown = runs.find((r) => r.id === picked) ?? mostRelevantSession(runs);
  const active = runs.find((r) => r.status === 'running' || needsInput(r));
  const reviewing = active?.status === 'running';
  const none = prs?.length === 0;

  return (
    <section className="cx-pj-section" aria-label="Dependency updates">
      <Flex alignItems="center" gap={12}>
        <Heading level={5} as="h2">
          Dependency updates
        </Heading>
        {prs && prs.length > 0 && <Chip size="condensed">{prs.length} open</Chip>}
        <span style={{ marginLeft: 'auto' }} />
        <Button
          variant="accent"
          color="primary"
          disabled={!prs || none || !!active}
          loading={reviewing}
          onClick={() => setPicked(reviewRenovatePrs(project.id))}
        >
          <Button.Prefix>
            <AiIcon />
          </Button.Prefix>
          {reviewing ? 'Reviewing…' : active ? 'Waiting for your answer' : 'Review Renovate PRs'}
        </Button>
      </Flex>

      <Text className="cx-tone-neutral">
        {!prs
          ? 'Loading the open Renovate PRs…'
          : none
            ? 'No open Renovate PRs, so there is nothing to review. New ones show up here when Renovate opens them.'
            : 'The agent reads each PR’s release notes and build, merges patch and minor updates that are green, and leaves the rest with a comment for you.'}
      </Text>

      {prs && prs.length > 0 && (
        <div className="cx-pj-deps" role="list">
          {prs.map((p) => (
            <PrRow key={p.number} pr={p} />
          ))}
        </div>
      )}

      {shown && (
        <div className="cx-pj-runs" ref={runRef}>
          {runs.length > 1 && (
            <Flex alignItems="center" gap={4} flexWrap="wrap">
              <Text textStyle="small" className="cx-tone-neutral" style={{ marginRight: 4 }}>
                {plural(runs.length, 'run')}
              </Text>
              {runs.map((r) => (
                <Button key={r.id} size="condensed" variant={r.id === shown.id ? 'accent' : 'default'} color={r.id === shown.id ? 'primary' : 'neutral'} onClick={() => setPicked(r.id)}>
                  <Button.Prefix>
                    <StatusDot session={r} />
                  </Button.Prefix>
                  {formatStarted(r.startedAt)}
                </Button>
              ))}
            </Flex>
          )}
          <div className="cx-root cx-pj-run" style={cxVars}>
            <div className="cx-pj-run-head">
              <StatusDot session={shown} />
              <Text textStyle="base-emphasized" className="cx-ellipsis">
                {shown.title}
              </Text>
              <Text textStyle="small" className="cx-tone-neutral" style={{ flex: 'none' }}>
                started {formatStarted(shown.startedAt)}
              </Text>
              <span style={{ marginLeft: 'auto' }} />
              <StatusChip session={shown} />
            </div>
            <Transcript session={shown} />
            <div className="cx-pj-run-composer">
              <SessionComposer session={shown} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
