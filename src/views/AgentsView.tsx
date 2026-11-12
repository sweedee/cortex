import { Button } from '@dynatrace/strato-components/buttons';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Heading, Text } from '@dynatrace/strato-components/typography';
import { PlusIcon } from '@dynatrace/strato-icons';
import { AGENT_KINDS, StatusChip, StatusDot, cxVars, formatStarted, kindLabel, plural, subduedText } from '../components/session/meta';
import { SessionComposer } from '../components/session/SessionComposer';
import { Transcript } from '../components/session/Transcript';
import type { AgentSession } from '../model/types';
import { launchAgent, openSession } from '../state/actions';
import { useCortex, useWorkSessions } from '../state/store';

const RANK = { running: 0, waiting: 1, failed: 2, done: 3 } as const;

function mostRelevant(sessions: AgentSession[]): AgentSession | undefined {
  // sessions are newest first, sort is stable
  return [...sessions].sort((a, b) => {
    const ra = RANK[a.status] - (a.status === 'waiting' && !a.activity ? -2 : 0);
    const rb = RANK[b.status] - (b.status === 'waiting' && !b.activity ? -2 : 0);
    return ra - rb;
  })[0];
}

function LaunchMenu({ workId }: { workId: string }) {
  return (
    <Menu>
      <Menu.Trigger>
        <Button size="condensed" variant="accent" color="primary">
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          New agent
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Group>
          {AGENT_KINDS.map((k) => (
            <Menu.Item key={k.kind} onSelect={() => launchAgent(workId, k.kind)}>
              <Menu.Prefix>{k.icon}</Menu.Prefix>
              {k.label}
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}

function SessionRow({ s, current }: { s: AgentSession; current: boolean }) {
  return (
    <button type="button" className="cx-btn cx-session" aria-current={current} onClick={() => openSession(s.id)}>
      <StatusDot session={s} />
      <Text className="cx-ellipsis" style={{ fontWeight: 600 }}>
        {s.title}
      </Text>
      <Text textStyle="small" style={subduedText}>
        {formatStarted(s.startedAt)}
      </Text>
      <span />
      <Text textStyle="small" className="cx-ellipsis" style={{ ...subduedText, gridColumn: '2 / 4' }}>
        {kindLabel(s.kind)}
        {s.status === 'running' && s.activity ? ` · ${s.activity}` : s.status === 'waiting' && s.activity ? ' · waiting for you' : ''}
      </Text>
    </button>
  );
}

function EmptyState({ workId }: { workId: string }) {
  return (
    <div className="cx-scroll cx-root" style={{ ...cxVars, height: '100%' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
        <Heading level={3}>Put Claude to work</Heading>
        <Text style={{ ...subduedText, display: 'block', marginTop: 4, marginBottom: 20 }}>
          No sessions on this work yet. Start an agent, several can run side by side.
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {AGENT_KINDS.map((k) => (
            <button key={k.kind} type="button" className="cx-btn cx-card" onClick={() => launchAgent(workId, k.kind)}>
              <Flex alignItems="center" gap={8}>
                {k.icon}
                <Text style={{ fontWeight: 600 }}>{k.label}</Text>
              </Flex>
              <Text textStyle="small" style={subduedText}>
                {k.description}
              </Text>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionPane({ session }: { session: AgentSession }) {
  const tools = session.messages.filter((m) => m.role === 'tool').length;
  const msgs = session.messages.length - tools;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div
        className="cx-root"
        style={{ ...cxVars, padding: '10px 16px', borderBottom: '1px solid var(--cx-border-subdued)', display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text className="cx-ellipsis" style={{ fontWeight: 600, display: 'block' }}>
            {session.title}
          </Text>
          <Text textStyle="small" className="cx-ellipsis" style={{ ...subduedText, display: 'block' }}>
            {kindLabel(session.kind)} · {session.model} · started {formatStarted(session.startedAt)} · {plural(msgs, 'message')},{' '}
            {plural(tools, 'tool call')}
          </Text>
        </div>
        <StatusChip session={session} />
      </div>
      <Transcript session={session} />
      <div className="cx-root" style={{ ...cxVars, padding: '8px 16px 14px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <SessionComposer session={session} />
        </div>
      </div>
    </div>
  );
}

export function AgentsView({ workId }: { workId: string }) {
  const sessions = useWorkSessions(workId);
  const wanted = useCortex((s) => s.view.sessionId);
  if (sessions.length === 0) return <EmptyState workId={workId} />;
  const selected = sessions.find((s) => s.id === wanted) ?? mostRelevant(sessions)!;

  return (
    <div className="cx-root" style={{ ...cxVars, height: '100%', display: 'flex', minHeight: 0 }}>
      <div
        style={{
          width: 280,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--cx-border-subdued)',
          minHeight: 0,
        }}
      >
        <div style={{ padding: '10px 10px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text textStyle="small" style={{ ...subduedText, fontWeight: 600 }}>
            Sessions ({sessions.length})
          </Text>
          <LaunchMenu workId={workId} />
        </div>
        <div className="cx-scroll" style={{ flex: 1, minHeight: 0, padding: '0 6px 8px' }}>
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} current={s.id === selected.id} />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SessionPane session={selected} />
      </div>
    </div>
  );
}
