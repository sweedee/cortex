import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import type { PrState, Project, TicketStatus, WorkItem } from '../../model/types';
import { selectWork, startWorkOnTicket } from '../../state/actions';
import type { Tone } from '../../state/derive';
import { useCortex } from '../../state/store';
import { ProjectDependencies } from './ProjectDependencies';
import './projects.css';
import '../../shell/shell.css';

const TICKET_TONE: Record<TicketStatus, Tone> = { 'To Do': 'neutral', 'In Progress': 'primary', 'In Review': 'warning', Done: 'success' };
const PR_TONE: Record<PrState, Tone> = { draft: 'neutral', open: 'primary', approved: 'success', 'changes-requested': 'warning', merged: 'success' };
const CI_TONE = { queued: 'neutral', running: 'primary', passed: 'success', failed: 'critical' } as const;

function Row({ work, live }: { work: WorkItem; live: number }) {
  const { ticket, worktree: wt, pr, pipeline: ci } = work;
  return (
    <div className="cx-pj-rowgroup">
      <button className="cx-pj-cell" onClick={() => selectWork(work.id)} aria-label={`Open ${work.title}`}>
        <span className="cx-mono" style={{ flex: 'none' }}>
          {ticket?.key ?? (work.kind === 'review' ? `PR #${pr?.number}` : 'Ad hoc')}
        </span>
        <span className="cx-ellipsis">{work.title}</span>
      </button>
      <button className="cx-pj-cell" onClick={() => selectWork(work.id)} tabIndex={-1}>
        {ticket ? (
          <Chip size="condensed" color={TICKET_TONE[ticket.status]}>
            {ticket.status}
          </Chip>
        ) : (
          <span className="cx-tone-neutral">-</span>
        )}
      </button>
      <button className="cx-pj-cell" onClick={() => selectWork(work.id, 'agents')} tabIndex={-1}>
        {wt ? <span className="cx-mono cx-ellipsis">{wt.branch}</span> : <span className="cx-tone-neutral">no worktree</span>}
      </button>
      <button className="cx-pj-cell" onClick={() => selectWork(work.id, 'review')} tabIndex={-1}>
        {pr ? (
          <>
            <span className="cx-mono">#{pr.number}</span>
            <span className={`cx-tone-${PR_TONE[pr.state]}`}>{pr.state}</span>
          </>
        ) : (
          <span className="cx-tone-neutral">-</span>
        )}
      </button>
      <button className="cx-pj-cell" onClick={() => selectWork(work.id, 'pipeline')} tabIndex={-1}>
        {ci ? (
          <>
            <span className="cx-mono">#{ci.buildNumber}</span>
            <span className={`cx-tone-${CI_TONE[ci.status]}`}>{ci.status}</span>
          </>
        ) : (
          <span className="cx-tone-neutral">-</span>
        )}
      </button>
      <button className="cx-pj-cell" onClick={() => selectWork(work.id, 'agents')} tabIndex={-1}>
        <span className={live > 0 ? 'cx-tone-primary' : 'cx-tone-neutral'}>{live}</span>
      </button>
    </div>
  );
}

export function ProjectWork({ project }: { project: Project }) {
  const allWork = useCortex((s) => s.work);
  const sessions = useCortex((s) => s.sessions);
  const backlog = useCortex((s) => s.backlog);
  const work = allWork.filter((w) => w.repo === project.id);
  const tickets = backlog.filter((t) => t.labels.includes(project.id) || t.labels.some((l) => project.jira.labels.includes(l)));

  return (
    <div className="cx-pj-scroll">
      <div className="cx-pj-page">
        <section className="cx-pj-section">
          <Heading level={5} as="h2">
            In flight
          </Heading>
          {work.length === 0 ? (
            <Text className="cx-tone-neutral">Nothing in flight for {project.name}. Start a ticket from the backlog below.</Text>
          ) : (
            <div className="cx-pj-table" role="table">
              {['Work', 'Ticket', 'Branch', 'PR', 'Build', 'Claude'].map((h) => (
                <Text key={h} textStyle="small-emphasized" className="cx-pj-th">
                  {h}
                </Text>
              ))}
              {work.map((w) => (
                <Row key={w.id} work={w} live={sessions.filter((s) => s.workId === w.id && s.status === 'running').length} />
              ))}
            </div>
          )}
        </section>

        <ProjectDependencies project={project} />

        <section className="cx-pj-section">
          <Heading level={5} as="h2">
            Backlog
          </Heading>
          {tickets.length === 0 ? (
            <Text className="cx-tone-neutral">No assigned tickets carry this project's labels ({[project.id, ...project.jira.labels].filter((v, i, a) => a.indexOf(v) === i).join(', ')}).</Text>
          ) : (
            <div>
              {tickets.map((t) => (
                <div key={t.key} className="cx-pj-backlog">
                  <Text className="cx-mono">{t.key}</Text>
                  <Text className="cx-ellipsis">{t.summary}</Text>
                  <Chip size="condensed" color={TICKET_TONE[t.status]}>
                    {t.status}
                  </Chip>
                  <Button size="condensed" variant="accent" color="primary" onClick={() => startWorkOnTicket(t.key)}>
                    Start
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
