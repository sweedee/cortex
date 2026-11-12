import { useState, type MouseEvent, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Flex, Surface } from '@dynatrace/strato-components/layouts';
import { Menu } from '@dynatrace/strato-components/navigation';
import { Tooltip } from '@dynatrace/strato-components/overlays';
import { Text } from '@dynatrace/strato-components/typography';
import {
  ActionIcon,
  AiIcon,
  BookmarkIcon,
  BugReportIcon,
  ChatIcon,
  CheckmarkIcon,
  CodeIcon,
  CompareIcon,
  DeleteIcon,
  DesktopIcon,
  DotMenuIcon,
  IdeaIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ResearchIcon,
  SourceIcon,
  StopIcon,
  SyncIcon,
  ViewIcon,
  WorkflowIcon,
} from '@dynatrace/strato-icons';
import type { AgentSession, PrState, TicketStatus, WorkItem } from '../model/types';
import {
  archiveWork,
  createWorktree,
  launchAgent,
  launchApp,
  openCreatePrDialog,
  requestAiReview,
  openSession,
  runPipeline,
  selectWork,
  stopApp,
  syncWithBase,
} from '../state/actions';
import { aiReviewPending, attentionOf, nextActionOf, parentOf, pendingComments, relativeTime, unresolvedThreads, type Tone } from '../state/derive';
import { useBusy, useCortex } from '../state/store';
import { addTodo, openTodos } from '../state/todos';
import { AutoFocus } from '../components/AutoFocus';
import { TodoItem } from '../components/TodoItem';
import { TextInput } from '@dynatrace/strato-components/forms';

const TICKET_TONE: Record<TicketStatus, Tone> = {
  'To Do': 'neutral',
  'In Progress': 'primary',
  'In Review': 'warning',
  Done: 'success',
};

const PR_LABEL: Record<PrState, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'primary' },
  approved: { label: 'Approved', tone: 'success' },
  'changes-requested': { label: 'Changes requested', tone: 'warning' },
  merged: { label: 'Merged', tone: 'success' },
};

function KindIcon({ work }: { work: WorkItem }) {
  if (work.kind === 'review') return <ViewIcon />;
  if (work.kind === 'adhoc') return <ActionIcon />;
  switch (work.ticket?.type) {
    case 'Bug':
      return <BugReportIcon />;
    case 'Spike':
      return <ResearchIcon />;
    case 'Task':
      return <CheckmarkIcon />;
    default:
      return <BookmarkIcon />;
  }
}

/** One clickable status line: icon · text · right-aligned meta. Deep-links into the main view. */
function Row(props: { icon: ReactNode; onClick: () => void; children: ReactNode; meta?: ReactNode; label: string }) {
  return (
    <button
      className="cx-row"
      aria-label={props.label}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.icon}
      <span className="cx-ellipsis">{props.children}</span>
      {props.meta && <span className="cx-row-meta">{props.meta}</span>}
    </button>
  );
}

const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

function IconAction(props: { tip: string; onClick: () => void; children: ReactNode; loading?: boolean; disabled?: boolean }) {
  return (
    <Tooltip text={props.tip}>
      <Button size="condensed" aria-label={props.tip} onClick={stop(props.onClick)} loading={props.loading} disabled={props.disabled}>
        <Button.Prefix>{props.children}</Button.Prefix>
      </Button>
    </Tooltip>
  );
}

function AgentRows({ work, sessions }: { work: WorkItem; sessions: AgentSession[] }) {
  if (sessions.length === 0) return null;
  const live = sessions.filter((s) => s.status === 'running' || (s.status === 'waiting' && s.activity));
  if (live.length === 0) {
    const last = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return (
      <Row icon={<AiIcon />} label="Open Claude sessions" onClick={() => selectWork(work.id, 'agents')} meta={relativeTime(last.startedAt)}>
        <span className="cx-tone-neutral">
          {sessions.length} session{sessions.length > 1 ? 's' : ''} · last: {last.title.split(' · ')[0]}
        </span>
      </Row>
    );
  }
  return (
    <>
      {live.map((s) => (
        <Row
          key={s.id}
          icon={<AiIcon />}
          label={`Open session ${s.title}`}
          onClick={() => {
            selectWork(work.id);
            openSession(s.id);
          }}
          meta={
            <span className={s.status === 'running' ? 'cx-tone-primary' : 'cx-tone-warning'} style={{ display: 'flex' }}>
              <span className="cx-dot" data-pulse={s.status === 'running'} />
            </span>
          }
        >
          <Text textStyle="small-emphasized">{s.kind === 'chat' ? 'Chat' : s.kind[0].toUpperCase() + s.kind.slice(1)}</Text>
          <span className="cx-tone-neutral"> · {s.activity ?? 'Working…'}</span>
        </Row>
      ))}
    </>
  );
}

const MAX_CARD_TODOS = 3;

/** Open todos attached to this work, tickable in place, plus the inline "add todo" input. */
function CardTodos({ workId, adding, onDone }: { workId: string; adding: boolean; onDone: () => void }) {
  const todos = useCortex((s) => s.todos);
  const open = todos.filter((t) => t.workId === workId && !t.done);
  const [text, setText] = useState('');
  if (open.length === 0 && !adding) return null;

  return (
    <div className="cx-card-todos">
      {open.slice(0, MAX_CARD_TODOS).map((t) => (
        <TodoItem key={t.id} todo={t} compact />
      ))}
      {open.length > MAX_CARD_TODOS && (
        <button className="cx-row" onClick={stop(openTodos)}>
          <span className="cx-tone-neutral">+{open.length - MAX_CARD_TODOS} more todos</span>
        </button>
      )}
      {adding && (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ paddingTop: 4 }}>
          <AutoFocus>
          <TextInput
            aria-label="New todo for this work"
            placeholder="Todo… (Enter to add, Esc to close)"
            value={text}
            onChange={setText}
            onBlur={() => !text.trim() && onDone()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                addTodo(text, workId);
                setText('');
              }
              if (e.key === 'Escape') {
                setText('');
                onDone();
              }
            }}
          />
          </AutoFocus>
        </div>
      )}
    </div>
  );
}

export function WorkCard({ work, selected }: { work: WorkItem; selected: boolean }) {
  const allSessions = useCortex((s) => s.sessions);
  const me = useCortex((s) => s.me);
  const sessions = allSessions.filter((s) => s.workId === work.id);
  const allWork = useCortex((s) => s.work);
  const attention = attentionOf(work, allSessions, me, allWork);
  const next = nextActionOf(work, allSessions, me, allWork);
  const parent = parentOf(work, allWork);
  const aiPending = aiReviewPending(work.pr);
  const humans = work.pr?.reviewers.filter((r) => !r.isBot) ?? []; // the AI bot does not count towards approvals
  const nextBusy = useBusy(work.id, next?.busyKey ?? '-');
  const worktreeBusy = useBusy(work.id, 'worktree');
  const prBusy = useBusy(work.id, 'pr');
  const syncBusy = useBusy(work.id, 'sync');

  const { worktree: wt, pr, pipeline: ci, app, ticket } = work;
  const unresolved = unresolvedThreads(pr);
  const pending = pendingComments(pr);
  const ciStage = ci?.stages.find((s) => s.status === 'failed') ?? ci?.stages.find((s) => s.status === 'running');
  const ciTone: Tone = ci?.status === 'failed' ? 'critical' : ci?.status === 'passed' ? 'success' : 'primary';
  const agentRunning = sessions.some((s) => s.status === 'running');
  const [addingTodo, setAddingTodo] = useState(false);

  return (
    <Surface
      className="cx-card"
      elevation={selected ? 'raised' : 'flat'}
      selected={selected}
      padding={12}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => selectWork(work.id)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) selectWork(work.id);
      }}
    >
      {/* identity */}
      <Flex alignItems="center" gap={6}>
        <KindIcon work={work} />
        <Text textStyle="small-emphasized" className={work.kind === 'adhoc' ? undefined : 'cx-mono'}>
          {ticket?.key ?? (work.kind === 'review' ? `PR #${pr?.number}` : 'Ad hoc')}
        </Text>
        <Text textStyle="small" className="cx-tone-neutral cx-ellipsis">
          {work.repo}
        </Text>
        <span style={{ marginLeft: 'auto' }} />
        {ticket && (
          <Chip size="condensed" color={TICKET_TONE[ticket.status]}>
            {ticket.status}
          </Chip>
        )}
        {/* menu items render in a portal but still bubble through React — keep them from selecting the card */}
        <span style={{ display: 'flex' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Menu>
          <Menu.Trigger>
            <Button size="condensed" aria-label="More actions" onClick={(e: MouseEvent) => e.stopPropagation()}>
              <Button.Prefix>
                <DotMenuIcon />
              </Button.Prefix>
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Group>
              <Menu.Label>Claude</Menu.Label>
              <Menu.Item onSelect={() => launchAgent(work.id, 'plan')}>
                <Menu.Prefix><IdeaIcon /></Menu.Prefix>Plan
              </Menu.Item>
              <Menu.Item onSelect={() => launchAgent(work.id, 'implement')}>
                <Menu.Prefix><CodeIcon /></Menu.Prefix>Implement
              </Menu.Item>
              <Menu.Item onSelect={() => launchAgent(work.id, 'review')}>
                <Menu.Prefix><ViewIcon /></Menu.Prefix>Self-review
              </Menu.Item>
              <Menu.Item onSelect={() => launchAgent(work.id, 'fix-ci')} disabled={!ci}>
                <Menu.Prefix><WorkflowIcon /></Menu.Prefix>Fix CI
              </Menu.Item>
              <Menu.Item onSelect={() => launchAgent(work.id, 'chat')}>
                <Menu.Prefix><ChatIcon /></Menu.Prefix>New chat
              </Menu.Item>
            </Menu.Group>
            <Menu.Group>
              <Menu.Label>Workspace</Menu.Label>
              <Menu.Item onSelect={() => void createWorktree(work.id)} disabled={!!wt}>
                <Menu.Prefix><PlusIcon /></Menu.Prefix>Create worktree
              </Menu.Item>
              <Menu.Item onSelect={() => void syncWithBase(work.id)} disabled={!wt || wt.behind === 0}>
                <Menu.Prefix><SyncIcon /></Menu.Prefix>Rebase on {wt?.baseBranch ?? 'main'}
              </Menu.Item>
              <Menu.Item onSelect={() => openCreatePrDialog(work.id)} disabled={!wt || !!pr}>
                <Menu.Prefix><CompareIcon /></Menu.Prefix>Create pull request…
              </Menu.Item>
              <Menu.Item onSelect={() => void requestAiReview(work.id)} disabled={!pr || pr.state === 'merged' || aiPending}>
                <Menu.Prefix><AiIcon /></Menu.Prefix>{aiPending ? 'AI review requested' : 'Request AI review'}
              </Menu.Item>
              <Menu.Item onSelect={() => void runPipeline(work.id)} disabled={!wt && !pr}>
                <Menu.Prefix><RefreshIcon /></Menu.Prefix>Run build
              </Menu.Item>
            </Menu.Group>
            <Menu.Group>
              <Menu.Item onSelect={() => setAddingTodo(true)}>
                <Menu.Prefix><CheckmarkIcon /></Menu.Prefix>Add todo
              </Menu.Item>
              <Menu.Item onSelect={() => archiveWork(work.id)}>
                <Menu.Prefix><DeleteIcon /></Menu.Prefix>Archive
              </Menu.Item>
            </Menu.Group>
          </Menu.Content>
        </Menu>
        </span>
      </Flex>

      <Text textStyle="base-emphasized" className="cx-clamp2">
        {work.kind === 'review' ? (pr?.title ?? work.title) : work.title}
      </Text>

      {/* status lines */}
      <div>
        {wt ? (
          <Row
            icon={<SourceIcon />}
            label="Worktree"
            onClick={() => selectWork(work.id, 'agents')}
            meta={
              <>
                {syncBusy && <span>rebasing…</span>}
                {wt.ahead > 0 && <span>↑{wt.ahead}</span>}
                {wt.behind > 0 && (
                  <span className="cx-tone-warning" title={`${wt.behind} behind ${wt.baseBranch}`}>
                    ↓{wt.behind} behind
                  </span>
                )}
                {wt.dirtyFiles > 0 && <span>±{wt.dirtyFiles}</span>}
              </>
            }
          >
            <span className="cx-mono">{wt.branch}</span>
          </Row>
        ) : (
          work.kind !== 'review' && (
            <Row icon={<SourceIcon />} label="Create worktree" onClick={() => void createWorktree(work.id)}>
              <span className="cx-tone-neutral">{worktreeBusy ? 'Creating worktree…' : 'No worktree yet'}</span>
            </Row>
          )
        )}

        <AgentRows work={work} sessions={sessions} />

        {pr ? (
          <Row
            icon={<CompareIcon />}
            label="Open pull request"
            onClick={() => selectWork(work.id, 'review')}
            meta={
              <>
                {pending > 0 && <span className="cx-tone-primary">{pending} pending</span>}
                {unresolved > 0 && (
                  <span className="cx-tone-warning" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <ChatIcon size="small" />
                    {unresolved}
                  </span>
                )}
              </>
            }
          >
            <span className="cx-mono">#{pr.number}</span>{' '}
            <span className={`cx-tone-${PR_LABEL[pr.state].tone}`}>
              {pr.reviewRequested && pr.state === 'open' ? `by ${pr.author.split(' ')[0]} · review requested` : PR_LABEL[pr.state].label}
            </span>
            {!pr.reviewRequested && pr.state !== 'merged' && humans.length > 0 && (
              <span className="cx-tone-neutral">
                {' '}· {humans.filter((r) => r.state === 'approved').length}/{humans.length} approved
              </span>
            )}
            {parent?.pr && pr.state !== 'merged' && (
              <span className="cx-tone-neutral" title={`Targets ${pr.targetBranch}, the branch of #${parent.pr.number}`}>
                {' '}· stacked on #{parent.pr.number}{parent.pr.state === 'merged' ? ' (merged)' : ''}
              </span>
            )}
            {aiPending && <span className="cx-tone-primary"> · AI review…</span>}
          </Row>
        ) : (
          prBusy && (
            <Row icon={<CompareIcon />} label="Pull request" onClick={() => selectWork(work.id, 'review')}>
              <span className="cx-tone-neutral">Opening pull request…</span>
            </Row>
          )
        )}

        {ci && (
          <Row
            icon={<WorkflowIcon />}
            label="Open build"
            onClick={() => selectWork(work.id, 'pipeline')}
            meta={
              <span className="cx-stages" aria-hidden>
                {ci.stages.map((s) => (
                  <span key={s.name} className="cx-stage" data-status={s.status} title={`${s.name}: ${s.status}`} />
                ))}
              </span>
            }
          >
            <span className="cx-mono">#{ci.buildNumber}</span>{' '}
            <span className={`cx-tone-${ciTone}`}>{ci.status}</span>
            {ciStage && <span className="cx-tone-neutral"> · {ciStage.name}</span>}
          </Row>
        )}

        {app.status !== 'stopped' && (
          <Row
            icon={<DesktopIcon />}
            label="Open app preview"
            onClick={() => selectWork(work.id, 'preview')}
            meta={
              <span className={app.status === 'running' ? 'cx-tone-success' : 'cx-tone-primary'} style={{ display: 'flex' }}>
                <span className="cx-dot" data-pulse={app.status === 'starting'} />
              </span>
            }
          >
            {app.status === 'running' ? (
              <>
                App running <span className="cx-mono cx-tone-neutral">localhost:{app.port}</span>
              </>
            ) : (
              <span className="cx-tone-neutral">Starting app…</span>
            )}
          </Row>
        )}

        <CardTodos workId={work.id} adding={addingTodo} onDone={() => setAddingTodo(false)} />
      </div>

      {/* actions */}
      <Flex alignItems="center" gap={4}>
        {next && (
          <Tooltip text={next.hint}>
            <Button
              size="condensed"
              variant={attention.group === 'needs-you' || selected ? 'accent' : 'emphasized'}
              color={attention.group === 'needs-you' && attention.tone !== 'neutral' ? attention.tone : 'primary'}
              loading={nextBusy}
              onClick={stop(next.run)}
            >
              {next.label}
            </Button>
          </Tooltip>
        )}
        {attention.reason && (
          <Text textStyle="small" className={`cx-tone-${attention.tone} cx-ellipsis`}>
            {attention.reason}
          </Text>
        )}
        <span style={{ marginLeft: 'auto' }} />
        {work.kind !== 'review' && (
          <>
            <IconAction tip="Plan with Claude" onClick={() => launchAgent(work.id, 'plan')} disabled={agentRunning}>
              <IdeaIcon />
            </IconAction>
            <IconAction tip="Implement with Claude" onClick={() => launchAgent(work.id, 'implement')} disabled={agentRunning || !wt}>
              <CodeIcon />
            </IconAction>
          </>
        )}
        <IconAction tip="Chat about this work" onClick={() => launchAgent(work.id, 'chat')}>
          <ChatIcon />
        </IconAction>
        {app.status === 'stopped' ? (
          <IconAction tip="Launch app" onClick={() => void launchApp(work.id)}>
            <PlayIcon />
          </IconAction>
        ) : (
          <IconAction tip="Stop app" onClick={() => stopApp(work.id)}>
            <StopIcon />
          </IconAction>
        )}
      </Flex>
    </Surface>
  );
}
