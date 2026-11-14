/**
 * The agent's sidebar: a basic Claude Code harness. Transcript (markdown messages, collapsible tool
 * calls, thinking), the open question as a card, permission prompts, a composer for follow-ups and
 * a status line. Ported from the `prototype` branch's `components/session/*`, on the real data:
 * `useClaudeTranscript` (raw events → rows, see transcript.ts) and `useClaudeSession` (status, usage,
 * pending prompts). Demo agents (no `localId`) show an empty state and their seeded question.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { AiLoadingIndicator, Chip, ProgressCircle } from '@dynatrace/strato-components/content';
import { ArrowUpIcon, BlockIcon, CheckmarkIcon, ChevronDownIcon, ChevronRightIcon, CriticalIcon, PauseIcon, StopIcon } from '@dynatrace/strato-icons';
import { toolSummary, type ClaudeSession, type PendingPermission } from '../../../../shared/integrations/claude';
import { Markdown } from '../../components/viewers';
import { claudeOps, useClaudeSession, useClaudeTranscript } from '../../data/claude';
import type { ItemOf } from '../../domain';
import { isDesktop } from '../../native';
import { DefaultSidebar, SidebarTabs } from '../../sidebar';
import { TONE_CHIP } from '../../tones';
import { errorText, openUrl } from '../../ui/task';
import { toast } from '../common';
import type { SidebarProps } from '../types';
import { answerQuestion, decidePermission, interruptAgent, stopAgent } from './session';
import { agentRing } from './ring';
import {
  answersOf,
  buildRows,
  contextTone,
  emptyChoice,
  groupRows,
  inputText,
  isAnswered,
  toggleChoice,
  toggleOther,
  usd,
  type Choice,
  type Row,
} from './transcript';
import './agent.css';

type Agent = ItemOf<'agent'>;
type Question = NonNullable<Agent['data']['pendingQuestion']>['questions'][number];

export function AgentSidebar({ item, ctx }: SidebarProps<'agent'>) {
  return (
    <SidebarTabs
      rememberAs="agent"
      initial="session"
      tabs={[
        { id: 'session', label: 'Session', render: () => <Harness key={item.id} agent={item} /> },
        { id: 'details', label: 'Details', render: () => <DefaultSidebar item={item} ctx={ctx} /> },
      ]}
    />
  );
}

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function Harness({ agent }: { agent: Agent }) {
  const localId = agent.data.localId;
  const real = !!localId && isDesktop;
  const session = useClaudeSession(localId);
  const transcript = useClaudeTranscript(localId);
  const rows = useMemo(() => buildRows(transcript.data ?? [], localId), [transcript.data, localId]);
  const s = session.data;
  const status = agent.data.status;
  const running = status === 'running';
  const pendingQ = agent.data.pendingQuestion;
  const perms: { requestId: string; toolName: string; summary?: string; reason?: string }[] = s?.pendingPermissions?.length
    ? s.pendingPermissions.map((p: PendingPermission) => ({ requestId: p.requestId, toolName: p.toolName, summary: toolSummary(p.input), reason: p.reason }))
    : (agent.data.pendingPermissions ?? []);

  // keep the transcript scrolled to the end while the user hasn't scrolled up
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const last = rows[rows.length - 1];
  const tick = `${rows.length}:${last && 'text' in last ? last.text.length : (last?.status ?? '')}:${status}:${perms.length}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [tick]);

  const blocks = groupRows(rows);
  const hasOpenCard = rows.some((r) => r.kind === 'question' && r.status === 'running');

  let body: ReactNode;
  if (!real) {
    body = (
      <>
        <div className="ah-empty">
          <div className="ah-empty-title">No Claude Code session attached</div>
          <div>{localId ? 'Sessions only run in the desktop app.' : 'This is a demo agent. Start a real one from the chat box: describe the task and @mention a worktree or project.'}</div>
        </div>
        {pendingQ && <QuestionCard agent={agent} questions={pendingQ.questions} />}
      </>
    );
  } else if (transcript.isPending && session.isPending) {
    body = (
      <div className="ah-empty">
        <ProgressCircle size="small" aria-label="Loading the session" />
      </div>
    );
  } else {
    body = (
      <>
        {transcript.error && <div className="ah-error">Could not load the transcript: {errorText(transcript.error)}</div>}
        {!rows.length && !transcript.error && <div className="ah-empty">No messages yet.</div>}
        {blocks.map((b) =>
          b.kind === 'tools' ? (
            <div key={b.id} className="ah-tools">
              {b.rows.map((r) => (
                <ToolRow key={r.id} row={r} />
              ))}
            </div>
          ) : (
            <RowView key={b.row.id} row={b.row} agent={agent} />
          ),
        )}
        {/* the question is known from the state before its event reached the transcript */}
        {pendingQ && !hasOpenCard && <QuestionCard agent={agent} questions={pendingQ.questions} />}
      </>
    );
  }

  return (
    <div className="ah">
      <div
        className="ah-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {body}
        {perms.map((p) => (
          <PermissionCard key={p.requestId} agent={agent} perm={p} />
        ))}
        {running && (
          <div className="ah-working">
            <AiLoadingIndicator>{agent.data.lastActivity ?? s?.activity ?? 'Working…'}</AiLoadingIndicator>
          </div>
        )}
        {status === 'failed' && <div className="ah-error">Session failed{agent.data.error ? `: ${agent.data.error}` : '.'}</div>}
      </div>
      <Composer agent={agent} real={real} />
      <StatusLine agent={agent} session={s} />
    </div>
  );
}

function RowView({ row, agent }: { row: Row; agent: Agent }) {
  switch (row.kind) {
    case 'user':
      return (
        <div className="ah-user-wrap">
          <div className="ah-user">{row.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="ah-md">
          <Markdown source={row.text} onLinkClick={(h) => void openUrl(h)} />
        </div>
      );
    case 'thinking':
      return <Thinking text={row.text} />;
    case 'question':
      if (row.status === 'running' && agent.data.pendingQuestion?.toolUseId === row.id) return <QuestionCard agent={agent} questions={agent.data.pendingQuestion.questions} />;
      return <AnsweredCard row={row} />;
    case 'tool':
      return <ToolRow row={row} />;
  }
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ah-thinking">
      <button type="button" className="ah-btn ah-thinking-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span>Thinking</span>
        {!open && <span className="ah-ellipsis ah-sub">{text.split('\n')[0]}</span>}
      </button>
      {open && <div className="ah-thinking-body">{text}</div>}
    </div>
  );
}

function ToolStatusIcon({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') return <span className="ah-spinner" aria-label="Running" />;
  if (status === 'error') return <CriticalIcon className="ah-ic-critical" aria-label="Failed" />;
  return <CheckmarkIcon className="ah-ic-success" aria-label="Succeeded" />;
}

function ToolRow({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const input = inputText(row.tool, row.input);
  const expandable = !!row.result || !!input;
  return (
    <div className="ah-tool">
      <button type="button" className="ah-btn ah-tool-row" disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => setOpen((o) => !o)} title={row.summary}>
        <span className="ah-sub">{expandable ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}</span>
        <ToolStatusIcon status={row.status} />
        <span className="ah-tool-name">{row.tool}</span>
        <span className="ah-ellipsis ah-mono ah-sub">{row.summary}</span>
        <span className="ah-sub ah-small">{clock(row.at)}</span>
      </button>
      {open && (
        <div className="ah-tool-detail">
          {input && <pre className="ah-pre">{input}</pre>}
          {row.result && <pre className={`ah-pre ${row.status === 'error' ? 'is-error' : ''}`}>{row.result}</pre>}
        </div>
      )}
    </div>
  );
}

function AnsweredCard({ row }: { row: Extract<Row, { kind: 'question' }> }) {
  const unanswered = row.status !== 'ok';
  return (
    <div className="ah-ask is-done">
      {row.questions.map((q) => (
        <div key={q.question} className="ah-ask-done-line">
          {q.header && (
            <Chip size="condensed" color="neutral">
              {q.header}
            </Chip>
          )}
          <span className="ah-sub">{q.question}</span>
          <strong className={unanswered ? 'ah-sub' : undefined}>{row.status === 'running' ? 'Waiting…' : unanswered ? 'No answer' : (row.answers?.[q.question] ?? 'Answered')}</strong>
        </div>
      ))}
    </div>
  );
}

function Option({ multi, checked, disabled, label, description, onClick }: { multi: boolean; checked: boolean; disabled?: boolean; label: string; description?: string; onClick: () => void }) {
  return (
    <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={checked} disabled={disabled} className="ah-btn ah-ask-opt" onClick={onClick}>
      <span className="ah-ask-mark" data-multi={multi} />
      <span style={{ minWidth: 0 }}>
        <span className="ah-ask-opt-label">{label}</span>
        {description && <span className="ah-sub ah-small ah-block">{description}</span>}
      </span>
    </button>
  );
}

/** The open AskUserQuestion: options (radio or, for multiSelect, checkboxes), "Other…" free text, Submit. */
export function QuestionCard({ agent, questions }: { agent: Agent; questions: Question[] }) {
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => emptyChoice));
  const [sent, setSent] = useState(false);
  const ready = choices.length === questions.length && choices.every(isAnswered);
  const set = (i: number, c: Choice) => setChoices((all) => all.map((x, j) => (j === i ? c : x)));
  const submit = async () => {
    setSent(true);
    await answerQuestion(agent, answersOf(questions, choices));
    setSent(false);
  };
  return (
    <div className="ah-ask" role="form" aria-label="Claude has a question">
      {questions.map((q, i) => {
        const multi = !!q.multiSelect;
        const c = choices[i] ?? emptyChoice;
        return (
          <div key={q.question} className="ah-ask-q" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
            <div className="ah-ask-head">
              {q.header && (
                <Chip color="primary" size="condensed">
                  {q.header}
                </Chip>
              )}
              <strong>{q.question}</strong>
              {multi && <span className="ah-sub ah-small">select any</span>}
            </div>
            {q.options.map((o) => (
              <Option key={o.label} multi={multi} checked={c.picked.includes(o.label)} disabled={sent} label={o.label} description={o.description} onClick={() => set(i, toggleChoice(c, o.label, multi))} />
            ))}
            <Option multi={multi} checked={c.other} disabled={sent} label="Other…" onClick={() => set(i, toggleOther(c, multi))} />
            {c.other && (
              <textarea
                className="ah-ask-other"
                rows={2}
                autoFocus
                disabled={sent}
                value={c.text}
                placeholder="Your own answer"
                aria-label={`Other answer for: ${q.question}`}
                onChange={(e) => set(i, { ...c, text: e.target.value })}
              />
            )}
          </div>
        );
      })}
      <div className="ah-ask-foot">
        <span className="ah-sub ah-small">Or type your answer in the box below.</span>
        <Button variant="accent" color="primary" size="condensed" disabled={!ready || sent} loading={sent} onClick={() => void submit()}>
          Submit
        </Button>
      </div>
    </div>
  );
}

function PermissionCard({ agent, perm }: { agent: Agent; perm: { requestId: string; toolName: string; summary?: string; reason?: string } }) {
  const [busy, setBusy] = useState(false);
  const decide = async (allow: boolean) => {
    setBusy(true);
    await decidePermission(agent, perm.requestId, allow);
    setBusy(false);
  };
  return (
    <div className="ah-perm" role="group" aria-label={`Permission for ${perm.toolName}`}>
      <div className="ah-perm-head">
        <strong>Allow {perm.toolName}?</strong>
      </div>
      {perm.summary && <pre className="ah-pre">{perm.summary}</pre>}
      {perm.reason && <div className="ah-sub ah-small">{perm.reason}</div>}
      <div className="ah-perm-actions">
        <Button size="condensed" variant="accent" color="primary" disabled={busy || !agent.data.localId} onClick={() => void decide(true)}>
          <Button.Prefix>
            <CheckmarkIcon />
          </Button.Prefix>
          Allow
        </Button>
        <Button size="condensed" color="critical" disabled={busy || !agent.data.localId} onClick={() => void decide(false)}>
          <Button.Prefix>
            <BlockIcon />
          </Button.Prefix>
          Deny
        </Button>
      </div>
    </div>
  );
}

function Composer({ agent, real }: { agent: Agent; real: boolean }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const status = agent.data.status;
  const running = status === 'running';
  const asking = !!agent.data.pendingQuestion;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t || !agent.data.localId || sending) return;
    setSending(true);
    try {
      await claudeOps.send(agent.data.localId, t);
      setText('');
    } catch (e) {
      toast('Could not send the message', errorText(e), 'critical');
    } finally {
      setSending(false);
    }
  };

  const placeholder = !real ? 'Demo agent: no session to talk to' : asking ? 'Answer above, or type your answer here…' : running ? 'Claude is working. Send a message to steer it…' : 'Reply to Claude…';
  return (
    <div className="ah-composer">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={!real}
        placeholder={placeholder}
        aria-label="Message to the agent"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (running) void interruptAgent(agent);
            else ref.current?.blur();
          }
        }}
      />
      <div className="ah-composer-bar">
        <span className="ah-sub ah-small ah-ellipsis">{running ? 'Esc to interrupt · Enter to send' : 'Enter to send · Shift+Enter for a new line'}</span>
        <span className="ah-composer-buttons">
          {real && running && (
            <Button size="condensed" onClick={() => void interruptAgent(agent)}>
              <Button.Prefix>
                <PauseIcon />
              </Button.Prefix>
              Interrupt
            </Button>
          )}
          {real && (running || status === 'waiting') && (
            <Button size="condensed" color="critical" onClick={() => void stopAgent(agent)} aria-label="Stop the session">
              <Button.Prefix>
                <StopIcon />
              </Button.Prefix>
            </Button>
          )}
          <Button variant="accent" color="primary" size="condensed" disabled={!real || !text.trim() || sending} loading={sending} onClick={() => void send()} aria-label="Send">
            <Button.Prefix>
              <ArrowUpIcon />
            </Button.Prefix>
            Send
          </Button>
        </span>
      </div>
    </div>
  );
}

function StatusLine({ agent, session }: { agent: Agent; session: ClaudeSession | undefined }) {
  const ring = agentRing(agent)[0];
  const u = agent.data.usage;
  const pct = u?.contextPct;
  const tone = pct != null ? contextTone(pct) : 'normal';
  const model = session?.model ?? agent.data.model;
  const cost = session?.usage.costUsd ?? u?.costUsd;
  const turns = session?.usage.turns ?? u?.turns;
  return (
    <div className="ah-status" role="status" aria-label="Session status">
      <Chip size="condensed" color={TONE_CHIP[ring.tone]} variant={ring.tone === 'neutral' ? undefined : 'emphasized'}>
        {STATUS_LABEL[agent.data.status]}
      </Chip>
      {model && <span title="Model">{model.replace(/^claude-/, '')}</span>}
      {pct != null && (
        <span className={`ah-ctx tone-${tone}`} title="Context window in use">
          <span className="ah-ctx-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </span>
          {pct}%
        </span>
      )}
      {turns != null && turns > 0 && <span title="Finished turns">{turns === 1 ? '1 turn' : `${turns} turns`}</span>}
      {cost != null && cost > 0 && <span title="Cost of this session so far (USD)">{usd(cost)}</span>}
      {agent.data.status !== 'running' && agent.data.lastActivity && (
        <span className="ah-ellipsis" title={agent.data.lastActivity}>
          {agent.data.lastActivity}
        </span>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<Agent['data']['status'], string> = { running: 'Running', waiting: 'Waiting for you', idle: 'Idle', done: 'Done', failed: 'Failed' };
