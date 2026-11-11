import type { ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Avatar, Chip } from '@dynatrace/strato-components/content';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import Colors from '@dynatrace/strato-design-tokens/colors';
import Typography from '@dynatrace/strato-design-tokens/typography';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BlockIcon,
  BookmarkIcon,
  BugReportIcon,
  CheckmarkIcon,
  ChevronDownSmallIcon,
  ChevronRightSmallIcon,
  CodeIcon,
  CriticalFailedIcon,
  MinusIcon,
  ResearchIcon,
  SuccessIcon,
  SyncIcon,
  WorkflowSimpleIcon,
} from '@dynatrace/strato-icons';
import type { Ticket, TicketPriority, TicketStatus, TicketType, WorkItem, WorkTab } from '../../model/types';
import { setTab, transitionTicket } from '../../state/actions';
import { absoluteTime, initials, relativeTime } from './time';

const STATUSES: TicketStatus[] = ['To Do', 'In Progress', 'In Review', 'Done'];

const STATUS_COLOR: Record<TicketStatus, 'neutral' | 'primary' | 'warning' | 'success'> = {
  'To Do': 'neutral',
  'In Progress': 'primary',
  'In Review': 'warning',
  Done: 'success',
};

export function TypeIcon({ type }: { type: TicketType }) {
  const style = { flex: 'none' as const };
  switch (type) {
    case 'Bug':
      return <BugReportIcon size="small" style={{ ...style, color: Colors.Icon.Critical.Default }} />;
    case 'Story':
      return <BookmarkIcon size="small" style={{ ...style, color: Colors.Icon.Success.Default }} />;
    case 'Spike':
      return <ResearchIcon size="small" style={{ ...style, color: Colors.Icon.Warning.Default }} />;
    default:
      return <CheckmarkIcon size="small" style={{ ...style, color: Colors.Icon.Primary.Default }} />;
  }
}

function PriorityValue({ priority }: { priority: TicketPriority }) {
  const icon = {
    Blocker: <BlockIcon size="small" style={{ color: Colors.Icon.Critical.Default }} />,
    High: <ArrowUpIcon size="small" style={{ color: Colors.Icon.Critical.Default }} />,
    Medium: <MinusIcon size="small" style={{ color: Colors.Icon.Warning.Default }} />,
    Low: <ArrowDownIcon size="small" style={{ color: Colors.Icon.Primary.Default }} />,
  }[priority];
  return (
    <>
      {icon}
      {priority}
    </>
  );
}

function Person({ name, me }: { name: string; me: string }) {
  return (
    <>
      <Avatar size="small" abbreviation={initials(name)} aria-label={name} />
      <span className="ctx-ticket__ellipsis">
        {name}
        {name === me && <span style={{ color: Colors.Text.Neutral.Subdued }}> (you)</span>}
      </span>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ctx-ticket__field">
      <div className="ctx-ticket__field-label">{label}</div>
      <div className="ctx-ticket__field-value">{children}</div>
    </div>
  );
}

function StatusMenu({ workId, status }: { workId: string; status: TicketStatus }) {
  return (
    <Menu>
      <Menu.Trigger>
        <Button variant="emphasized" color={STATUS_COLOR[status]} size="condensed" aria-label={`Status: ${status}. Change status`}>
          {status}
          <Button.Suffix>
            <ChevronDownSmallIcon />
          </Button.Suffix>
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Group>
          <Menu.Label>Transition to</Menu.Label>
          {STATUSES.map((s) => (
            <Menu.Item key={s} disabled={s === status} onSelect={() => transitionTicket(workId, s)}>
              {s}
              {s === status && (
                <Menu.Suffix>
                  <CheckmarkIcon />
                </Menu.Suffix>
              )}
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

function DevRow({ icon, tab, children, hint }: { icon: ReactNode; tab: WorkTab; children: ReactNode; hint?: ReactNode }) {
  return (
    <button type="button" className="ctx-ticket__dev-row" onClick={() => setTab(tab)}>
      {icon}
      <span className="ctx-ticket__ellipsis" style={{ flex: 1 }}>
        {children}
      </span>
      {hint}
      <ChevronRightSmallIcon size="small" style={{ color: Colors.Icon.Neutral.Subdued, flex: 'none' }} />
    </button>
  );
}

/** Git / PR / CI state of the work item, as shortcuts to the other tabs. */
function Development({ work }: { work: WorkItem }) {
  const { worktree, pr, pipeline } = work;
  if (!worktree && !pr && !pipeline) return null;
  const subdued = { color: Colors.Icon.Neutral.Subdued, flex: 'none' as const };
  return (
    <>
      <div className="ctx-ticket__divider" />
      <div className="ctx-ticket__field-label" style={{ marginBottom: 4 }}>
        Development
      </div>
      {worktree && (
        <Tooltip text={`${worktree.branch} · ${worktree.path}`}>
          <div>
            <DevRow icon={<CodeIcon size="small" style={subdued} />} tab="agents">
              <span style={{ fontFamily: Typography.Code.Small.Default.Family }}>{worktree.branch}</span>
            </DevRow>
          </div>
        </Tooltip>
      )}
      {pr && (
        <DevRow
          icon={<WorkflowSimpleIcon size="small" style={subdued} />}
          tab="review"
          hint={
            <Chip size="condensed" color={pr.state === 'approved' || pr.state === 'merged' ? 'success' : pr.state === 'changes-requested' ? 'critical' : 'neutral'}>
              {pr.state.replace('-', ' ')}
            </Chip>
          }
        >
          Pull request #{pr.number}
        </DevRow>
      )}
      {pipeline && (
        <DevRow
          icon={
            pipeline.status === 'passed' ? (
              <SuccessIcon size="small" style={{ color: Colors.Icon.Success.Default, flex: 'none' }} />
            ) : pipeline.status === 'failed' ? (
              <CriticalFailedIcon size="small" style={{ color: Colors.Icon.Critical.Default, flex: 'none' }} />
            ) : (
              <SyncIcon size="small" style={{ color: Colors.Icon.Primary.Default, flex: 'none' }} />
            )
          }
          tab="pipeline"
        >
          Build #{pipeline.buildNumber} {pipeline.status}
        </DevRow>
      )}
    </>
  );
}

export function TicketFields({ work, ticket, me, now }: { work: WorkItem; ticket: Ticket; me: string; now: number }) {
  return (
    <div>
      <div className="ctx-ticket__fields">
        <Field label="Status">
          <StatusMenu workId={work.id} status={ticket.status} />
        </Field>
        <Field label="Priority">
          <PriorityValue priority={ticket.priority} />
        </Field>
        <Field label="Assignee">
          <Person name={ticket.assignee} me={me} />
        </Field>
        <Field label="Reporter">
          <Person name={ticket.reporter} me={me} />
        </Field>
        <Field label="Epic">
          {ticket.epic ? (
            <Chip size="condensed" color="primary">
              {ticket.epic}
            </Chip>
          ) : (
            <span style={{ color: Colors.Text.Neutral.Subdued }}>None</span>
          )}
        </Field>
        <Field label="Sprint">{ticket.sprint ?? <span style={{ color: Colors.Text.Neutral.Subdued }}>Backlog</span>}</Field>
        <Field label="Story points">
          {ticket.storyPoints !== undefined ? (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{ticket.storyPoints}</span>
          ) : (
            <span style={{ color: Colors.Text.Neutral.Subdued }}>Not estimated</span>
          )}
        </Field>
        <Field label="Labels">
          {ticket.labels.length ? (
            ticket.labels.map((l) => (
              <Chip key={l} size="condensed">
                {l}
              </Chip>
            ))
          ) : (
            <span style={{ color: Colors.Text.Neutral.Subdued }}>None</span>
          )}
        </Field>
        <Field label="Updated">
          <Tooltip text={absoluteTime(ticket.updatedAt)}>
            <span>{relativeTime(ticket.updatedAt, now)}</span>
          </Tooltip>
        </Field>
      </div>
      <Development work={work} />
    </div>
  );
}
