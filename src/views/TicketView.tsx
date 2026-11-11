import { Fragment, useState, type ReactNode } from 'react';
import { Checkbox } from '@dynatrace/strato-components/forms';
import { Markdown } from '@dynatrace/strato-components/content';
import { Tab, Tabs } from '@dynatrace/strato-components/navigation';
import { Code, Heading, Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { LinkBrokenIcon } from '@dynatrace/strato-icons';
import type { Ticket, WorkItem } from '../model/types';
import { selectWork } from '../state/actions';
import { useCortex, useWork, useWorkSessions } from '../state/store';
import { Comments } from './ticket/Comments';
import { TicketFields, TypeIcon } from './ticket/Fields';
import { PlanPanel, PlanStrip, planState } from './ticket/PlanSection';
import { ticketCss } from './ticket/styles';
import { useNow } from './ticket/time';

/** The Jira ticket of a work item, plus its implementation plan. */
export function TicketView({ workId }: { workId: string }) {
  // Keyed so that local state (checklist, draft comment, tab) resets per work item.
  return <TicketPage key={workId} workId={workId} />;
}

/** Renders `code` spans of a one-line string. */
function inlineCode(text: string): ReactNode {
  return text.split('`').map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : <Fragment key={i}>{part}</Fragment>));
}

function SectionTitle({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <div className="ctx-ticket__section-head">
      <Text textStyle="base-emphasized" as="h3" style={{ margin: 0 }}>
        {children}
      </Text>
      {count !== undefined && <span className="ctx-ticket__count">{count}</span>}
    </div>
  );
}

function AcceptanceCriteria({ ticket }: { ticket: Ticket }) {
  // Local-only checklist; tickets that are already in review start fully ticked.
  const [checked, setChecked] = useState<boolean[]>(() =>
    ticket.acceptanceCriteria.map(() => ticket.status === 'In Review' || ticket.status === 'Done'),
  );
  if (!ticket.acceptanceCriteria.length) return null;
  const done = checked.filter(Boolean).length;
  return (
    <section className="ctx-ticket__section">
      <SectionTitle count={`${done} of ${ticket.acceptanceCriteria.length} met`}>Acceptance criteria</SectionTitle>
      <div className="ctx-ticket__card ctx-ticket__ac">
        {ticket.acceptanceCriteria.map((criterion, i) => (
          <div className="ctx-ticket__ac-row" key={i}>
            <Checkbox
              name={`ac-${i}`}
              value={!!checked[i]}
              onChange={(v) => setChecked((c) => c.map((x, j) => (j === i ? v : x)))}
            >
              {inlineCode(criterion)}
            </Checkbox>
          </div>
        ))}
      </div>
    </section>
  );
}

function LinkedIssues({ ticket }: { ticket: Ticket }) {
  const workIds = useCortex((s) => s.work).map((w) => w.id);
  if (!ticket.links.length) return null;
  return (
    <section className="ctx-ticket__section">
      <SectionTitle count={ticket.links.length}>Linked issues</SectionTitle>
      <div className="ctx-ticket__card">
        {ticket.links.map((link) => (
          <div className="ctx-ticket__link-row" key={`${link.relation}:${link.key}`}>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              {link.relation}
            </Text>
            {workIds.includes(link.key) ? (
              <button type="button" className="ctx-ticket__key" onClick={() => selectWork(link.key, 'ticket')}>
                {link.key}
              </button>
            ) : (
              <span className="ctx-ticket__key">{link.key}</span>
            )}
            <Text className="ctx-ticket__ellipsis" title={link.summary}>
              {link.summary}
            </Text>
          </div>
        ))}
      </div>
    </section>
  );
}

function NoTicket({ work }: { work: WorkItem }) {
  return (
    <div className="ctx-ticket__card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
      <LinkBrokenIcon style={{ color: Colors.Icon.Neutral.Subdued, flex: 'none' }} />
      <div style={{ minWidth: 0 }}>
        <Text textStyle="base-emphasized" as="div">
          Not linked to a ticket
        </Text>
        <Text textStyle="small" as="div" style={{ color: Colors.Text.Neutral.Subdued }}>
          {work.kind === 'review'
            ? 'This work item is a pull request review. The plan below is the only thing tracked here.'
            : `This is ad-hoc work in ${work.repo}. There is no description, acceptance criteria or status to track — a plan can still be drafted.`}
        </Text>
      </div>
    </div>
  );
}

function TicketPage({ workId }: { workId: string }) {
  const work = useWork(workId);
  const sessions = useWorkSessions(workId);
  const me = useCortex((s) => s.me);
  const now = useNow();
  const [tab, setTabIndex] = useState(0);

  if (!work) return null;
  const { ticket } = work;
  const plan = planState(work, sessions);

  return (
    <div className="ctx-ticket">
      <style>{ticketCss}</style>
      <div className={`ctx-ticket__grid${ticket ? '' : ' ctx-ticket__grid--single'}`}>
        <div style={{ minWidth: 0 }}>
          {ticket && (
            <header style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <TypeIcon type={ticket.type} />
                <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                  {ticket.type}
                </Text>
                <span className="ctx-ticket__key">{ticket.key}</span>
              </div>
              <Heading level={4} as="h2" style={{ margin: 0 }}>
                {ticket.summary}
              </Heading>
            </header>
          )}

          <Tabs selectedIndex={tab} onChange={setTabIndex}>
            <Tab title="Details">
              <div style={{ paddingTop: 16 }}>
                <PlanStrip workId={workId} plan={plan} onShowPlan={() => setTabIndex(1)} />
                {ticket ? (
                  <>
                    <section className="ctx-ticket__section">
                      <SectionTitle>Description</SectionTitle>
                      <div className="ctx-ticket__md">
                        <Markdown>{ticket.descriptionMd}</Markdown>
                      </div>
                    </section>
                    <AcceptanceCriteria ticket={ticket} />
                    <LinkedIssues ticket={ticket} />
                    <Comments workId={workId} comments={ticket.comments} me={me} now={now} />
                  </>
                ) : (
                  <NoTicket work={work} />
                )}
              </div>
            </Tab>
            <Tab title="Plan">
              <div style={{ paddingTop: 16 }}>
                <PlanPanel workId={workId} plan={plan} />
              </div>
            </Tab>
          </Tabs>
        </div>

        {ticket && (
          <aside className="ctx-ticket__aside">
            <TicketFields work={work} ticket={ticket} me={me} now={now} />
          </aside>
        )}
      </div>
    </div>
  );
}
