import { Button } from '@dynatrace/strato-components/buttons';
import { Markdown, ProgressCircle } from '@dynatrace/strato-components/content';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { ChevronRightIcon, DavisCoPilotIcon, PlayIcon, RefreshIcon } from '@dynatrace/strato-icons';
import type { AgentSession, WorkItem } from '../../model/types';
import { launchAgent, openSession } from '../../state/actions';

export interface PlanState {
  planMd?: string;
  /** a plan agent that is drafting right now */
  drafting?: AgentSession;
  /** an implement agent that is running right now */
  implementing?: AgentSession;
  steps: number;
}

export function planState(work: WorkItem, sessions: AgentSession[]): PlanState {
  const running = (kind: AgentSession['kind']) => sessions.find((s) => s.kind === kind && s.status === 'running');
  return {
    planMd: work.planMd,
    drafting: running('plan'),
    implementing: running('implement'),
    steps: work.planMd ? (work.planMd.match(/^\s*\d+\.\s/gm)?.length ?? 0) : 0,
  };
}

function ImplementButton({ workId, plan }: { workId: string; plan: PlanState }) {
  if (plan.implementing) {
    const id = plan.implementing.id;
    return (
      <Button size="condensed" onClick={() => openSession(id)}>
        <Button.Prefix>
          <ProgressCircle size="small" aria-label="Implementation running" />
        </Button.Prefix>
        Implementing…
      </Button>
    );
  }
  return (
    <Button variant="accent" color="primary" size="condensed" onClick={() => launchAgent(workId, 'implement')}>
      <Button.Prefix>
        <PlayIcon />
      </Button.Prefix>
      Implement this plan
    </Button>
  );
}

function Drafting({ session }: { session: AgentSession }) {
  return (
    <>
      <ProgressCircle size="small" aria-label="Claude is drafting a plan" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text textStyle="base-emphasized">Claude is drafting a plan</Text>
        {session.activity && (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, marginLeft: 8 }}>
            {session.activity}
          </Text>
        )}
      </div>
      <Button size="condensed" onClick={() => openSession(session.id)}>
        Open session
        <Button.Suffix>
          <ChevronRightIcon />
        </Button.Suffix>
      </Button>
    </>
  );
}

/** Slim one-line summary of the plan state, shown above the ticket details. */
export function PlanStrip({ workId, plan, onShowPlan }: { workId: string; plan: PlanState; onShowPlan: () => void }) {
  if (plan.drafting) {
    return (
      <div className="ctx-ticket__strip">
        <Drafting session={plan.drafting} />
      </div>
    );
  }
  if (!plan.planMd) {
    return (
      <div className="ctx-ticket__strip ctx-ticket__strip--neutral">
        <DavisCoPilotIcon style={{ color: Colors.Icon.Neutral.Subdued, flex: 'none' }} />
        <Text style={{ flex: 1, minWidth: 0 }}>
          <Text textStyle="base-emphasized">No plan yet</Text>
          <span style={{ color: Colors.Text.Neutral.Subdued }}> — let Claude draft one</span>
        </Text>
        <Button variant="emphasized" color="primary" size="condensed" onClick={() => launchAgent(workId, 'plan')}>
          Draft plan
        </Button>
      </div>
    );
  }
  return (
    <div className="ctx-ticket__strip">
      <DavisCoPilotIcon style={{ color: Colors.Icon.Primary.Default, flex: 'none' }} />
      <Text style={{ flex: 1, minWidth: 0 }}>
        <Text textStyle="base-emphasized">Implementation plan ready</Text>
        {plan.steps > 0 && (
          <span style={{ color: Colors.Text.Neutral.Subdued }}>
            {' '}
            · {plan.steps} {plan.steps === 1 ? 'step' : 'steps'}
          </span>
        )}
      </Text>
      <Button size="condensed" onClick={onShowPlan}>
        View plan
      </Button>
      <ImplementButton workId={workId} plan={plan} />
    </div>
  );
}

/** Full plan, rendered as markdown — the content of the "Plan" tab. */
export function PlanPanel({ workId, plan }: { workId: string; plan: PlanState }) {
  if (!plan.planMd) {
    return (
      <div className={`ctx-ticket__strip${plan.drafting ? '' : ' ctx-ticket__strip--neutral'}`} style={{ marginBottom: 0 }}>
        {plan.drafting ? (
          <Drafting session={plan.drafting} />
        ) : (
          <>
            <DavisCoPilotIcon style={{ color: Colors.Icon.Neutral.Subdued, flex: 'none' }} />
            <Text style={{ flex: 1, minWidth: 0 }}>
              <Text textStyle="base-emphasized">No plan yet</Text>
              <span style={{ color: Colors.Text.Neutral.Subdued }}>
                {' '}
                — let Claude read the ticket and the code, and draft an implementation plan
              </span>
            </Text>
            <Button variant="emphasized" color="primary" size="condensed" onClick={() => launchAgent(workId, 'plan')}>
              Draft plan
            </Button>
          </>
        )}
      </div>
    );
  }
  return (
    <div>
      <div className="ctx-ticket__section-head" style={{ marginBottom: 12 }}>
        <Heading level={6} as="h3" style={{ flex: 1, minWidth: 0 }}>
          Implementation plan
        </Heading>
        {plan.drafting ? (
          <Button size="condensed" onClick={() => openSession(plan.drafting!.id)}>
            <Button.Prefix>
              <ProgressCircle size="small" aria-label="Re-drafting" />
            </Button.Prefix>
            Re-drafting…
          </Button>
        ) : (
          <Button size="condensed" onClick={() => launchAgent(workId, 'plan')}>
            <Button.Prefix>
              <RefreshIcon />
            </Button.Prefix>
            Re-draft
          </Button>
        )}
        <ImplementButton workId={workId} plan={plan} />
      </div>
      <div className="ctx-ticket__card ctx-ticket__md" style={{ padding: '16px 20px' }}>
        <Markdown>{plan.planMd}</Markdown>
      </div>
    </div>
  );
}
