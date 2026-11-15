/**
 * The agent's sidebar: a Claude Code harness. Transcript (markdown messages, collapsible tool
 * calls, thinking, subagents with their own tool calls nested), the open question as a card,
 * permission prompts, a composer (follow-ups, `/` commands, model / effort / permission-mode
 * pickers that change the running session) and a terminal-like status bar (context meter, tokens,
 * cache hits, cost, turns, subagents). Data: `useClaudeTranscript` (raw events → rows, see
 * transcript.ts) and `useClaudeSession` (status, usage, subagents, pending prompts). Demo agents
 * (no `localId`) show an empty state and their seeded question.
 *
 * Long sessions: the transcript is folded incrementally (`transcriptBuilder`), rows are memoized on
 * their identity, and only the latest `WINDOW` blocks are drawn ("Show more" adds older ones).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { AiLoadingIndicator, Chip, ProgressCircle } from '@dynatrace/strato-components/content';
import {
  AgentIcon,
  AIModelIcon,
  ArrowUpIcon,
  BlockIcon,
  CheckmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CriticalIcon,
  DatabaseIcon,
  PauseIcon,
  SecurityIcon,
  StopIcon,
  TerminalIcon,
  TokenIcon,
} from '@dynatrace/strato-icons';
import { toolSummary, type ClaudeConfigureRequest, type ClaudeEffort, type ClaudeSession, type PendingPermission, type SubagentInfo } from '../../../../shared/integrations/claude';
import { SessionPickers } from '../../chat/SessionPickers';
import { configureMessage, modelLabel, permissionChoice, slashOptions, type PermissionValue } from '../../chat/sessionOptions';
import { SKILLS } from '../../chat/skills';
import { Markdown } from '../../components/viewers';
import { claudeOps, useClaudeCatalog, useClaudeSession, useClaudeTranscript } from '../../data/claude';
import type { ItemOf } from '../../domain';
import { isDesktop } from '../../native';
import { DefaultSidebar, SidebarTabs } from '../../sidebar';
import { patchData } from '../../store';
import { TONE_CHIP } from '../../tones';
import { errorText, openUrl } from '../../ui/task';
import { toast } from '../common';
import { skillIcon } from '../icons';
import type { SidebarProps } from '../types';
import { answerQuestion, decidePermission, interruptAgent, stopAgent } from './session';
import { agentRing } from './ring';
import { answersOf, emptyChoice, groupRows, inputText, isAnswered, toggleChoice, toggleOther, transcriptBuilder, type Block, type Choice, type Row, type TranscriptBuilder } from './transcript';
import { contextTone, duration, subagentTally, tokens, usageView, usd } from './usage';
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

/** Blocks drawn at the end of the transcript; older ones wait behind "Show more". */
const WINDOW = 150;
const EMPTY: never[] = [];
const openLink = (h: string) => void openUrl(h);

function Harness({ agent }: { agent: Agent }) {
  const localId = agent.data.localId;
  const real = !!localId && isDesktop;
  const session = useClaudeSession(localId);
  const transcript = useClaudeTranscript(localId);
  // folds only the new events; unchanged rows keep their identity (see transcriptBuilder)
  const [builder, setBuilder] = useState<TranscriptBuilder>(() => transcriptBuilder(localId));
  if (builder.localId !== (localId ?? 'session')) setBuilder(transcriptBuilder(localId));
  const { rows, subagents: foldedSubs } = useMemo(() => builder.update(transcript.data ?? EMPTY), [builder, transcript.data]);
  const s = session.data;
  // the session state is fresher while running; the transcript fold works for restored sessions too
  const subagents = s?.subagents?.length ? s.subagents : foldedSubs;
  const status = agent.data.status;
  const running = status === 'running';
  const pendingQ = agent.data.pendingQuestion;
  const perms: { requestId: string; toolName: string; summary?: string; reason?: string }[] = s?.pendingPermissions?.length
    ? s.pendingPermissions.map((p: PendingPermission) => ({ requestId: p.requestId, toolName: p.toolName, summary: toolSummary(p.input), reason: p.reason }))
    : (agent.data.pendingPermissions ?? []);

  // keep the transcript scrolled to the end while the user hasn't scrolled up
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // the same, as state for the render (only set when it flips)
  const [following, setFollowing] = useState(true);
  const follow = (v: boolean) => {
    stick.current = v;
    setFollowing(v);
  };
  const last = rows[rows.length - 1];
  const tick = `${rows.length}:${last && 'text' in last ? last.text.length : last?.kind === 'subagent' ? last.children.length : (last?.status ?? '')}:${status}:${perms.length}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [tick]);

  // a click on a subagent badge opens and reveals its group in the transcript
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  const toggleSub = useCallback(
    (id: string, open?: boolean) =>
      setOpenSubs((prev) => {
        const next = new Set(prev);
        if (open ?? !next.has(id)) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );

  const blocks = useMemo(() => groupRows(rows), [rows]);
  const hasOpenCard = useMemo(() => rows.some((r) => r.kind === 'question' && r.status === 'running'), [rows]);

  // only the latest blocks are drawn; the window follows the end while the view sticks to it
  // (while the user reads further up it stays put, so nothing shifts under them)
  const [extra, setExtra] = useState(0);
  const [start, setStart] = useState(0);
  const wanted = Math.max(0, blocks.length - WINDOW - extra);
  const from = wanted < start || following ? wanted : start;
  if (from !== start) setStart(from);
  const shown = useMemo(() => (from > 0 ? blocks.slice(from) : blocks), [blocks, from]);

  const reveal = (id: string) => {
    const at = blocks.findIndex((b) => b.kind === 'row' && b.row.id === id);
    if (at >= 0 && at < from) setExtra(Math.max(0, blocks.length - WINDOW - at));
    toggleSub(id, true);
    follow(false);
    requestAnimationFrame(() => document.getElementById(subDomId(id))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

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
        {from > 0 && (
          <button
            type="button"
            className="ah-btn ah-earlier"
            onClick={() => {
              follow(false);
              setExtra((n) => n + WINDOW);
            }}
          >
            {from} earlier {from === 1 ? 'entry' : 'entries'} hidden · Show {Math.min(from, WINDOW)} more
          </button>
        )}
        <Blocks blocks={shown} agent={agent} openSubs={openSubs} toggleSub={toggleSub} />
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
          const v = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (v !== stick.current) follow(v);
        }}
      >
        {body}
        {perms.map((p) => (
          <PermissionCard key={p.requestId} agent={agent} perm={p} />
        ))}
        {running && (
          <div className="ah-working">
            <AiLoadingIndicator>{s?.activity ?? agent.data.lastActivity ?? 'Working…'}</AiLoadingIndicator>
          </div>
        )}
        {status === 'failed' && <div className="ah-error">Session failed{agent.data.error ? `: ${agent.data.error}` : '.'}</div>}
      </div>
      {subagents.length > 0 && <SubagentStrip subagents={subagents} onPick={reveal} />}
      <Composer agent={agent} real={real} session={s} />
      <StatusLine agent={agent} session={s} subagents={subagents} />
    </div>
  );
}

const subDomId = (toolUseId: string) => `ah-sub-${toolUseId.replace(/[^\w-]/g, '')}`;

function Blocks({ blocks, agent, openSubs, toggleSub }: { blocks: Block[]; agent: Agent; openSubs: Set<string>; toggleSub: (id: string) => void }) {
  return (
    <>
      {blocks.map((b) =>
        b.kind === 'tools' ? (
          <div key={b.id} className="ah-tools">
            {b.rows.map((r) => (
              <ToolRow key={r.id} row={r} />
            ))}
          </div>
        ) : b.row.kind === 'subagent' ? (
          <SubagentRow key={b.row.id} row={b.row} agent={agent} open={openSubs.has(b.row.id)} openSubs={openSubs} toggleSub={toggleSub} />
        ) : (
          <RowView key={b.row.id} row={b.row} agent={agent} />
        ),
      )}
    </>
  );
}

/** Rows only re-render when they change; the agent matters only to an open question (and a subagent holding one). */
const needsAgent = (r: Row): boolean => r.kind === 'question' || (r.kind === 'subagent' && r.children.some(needsAgent));

const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="ah-md">
      <Markdown source={text} onLinkClick={openLink} />
    </div>
  );
});

const RowView = memo(RowViewImpl, (a, b) => a.row === b.row && (a.agent === b.agent || !needsAgent(b.row)));
function RowViewImpl({ row, agent }: { row: Exclude<Row, { kind: 'subagent' }>; agent: Agent }) {
  switch (row.kind) {
    case 'user':
      return (
        <div className="ah-user-wrap">
          <div className="ah-user">{row.text}</div>
        </div>
      );
    case 'assistant':
      return <AssistantText text={row.text} />;
    case 'note':
      return <div className="ah-note">{row.text}</div>;
    case 'thinking':
      return <Thinking text={row.text} />;
    case 'question':
      if (row.status === 'running' && agent.data.pendingQuestion?.toolUseId === row.id) return <QuestionCard agent={agent} questions={agent.data.pendingQuestion.questions} />;
      return <AnsweredCard row={row} />;
    case 'tool':
      return <ToolRow row={row} />;
  }
}

function SubStatusIcon({ status }: { status: SubagentInfo['status'] }) {
  if (status === 'running') return <span className="ah-spinner" aria-label="Running" />;
  if (status === 'failed') return <CriticalIcon className="ah-ic-critical" aria-label="Failed" />;
  if (status === 'stopped') return <StopIcon className="ah-sub" aria-label="Stopped" />;
  return <CheckmarkIcon className="ah-ic-success" aria-label="Done" />;
}

/** "Explore · 3 tools · 19k tokens · 4.2s" */
const subFacts = (s: SubagentInfo) =>
  [s.type, s.background ? 'background' : '', `${s.toolUses} tool${s.toolUses === 1 ? '' : 's'}`, s.tokens ? `${tokens(s.tokens)} tokens` : '', s.durationMs ? duration(s.durationMs) : '']
    .filter(Boolean)
    .join(' · ');

/** A Task / Agent call: header with the subagent's status and numbers; open = its prompt, tool calls, text, result. */
type SubagentRowProps = { row: Extract<Row, { kind: 'subagent' }>; agent: Agent; open: boolean; openSubs: Set<string>; toggleSub: (id: string) => void };
const SubagentRow = memo(
  SubagentRowImpl,
  (a, b) => a.row === b.row && a.open === b.open && a.toggleSub === b.toggleSub && (a.openSubs === b.openSubs || !b.open) && (a.agent === b.agent || !needsAgent(b.row)),
);
function SubagentRowImpl({ row, agent, open, openSubs, toggleSub }: SubagentRowProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const childBlocks = useMemo(() => groupRows(row.children), [row.children]);
  const s = row.sub;
  const now = s.status === 'running' ? (s.activity ?? (s.lastTool ? `using ${s.lastTool}` : 'starting')) : '';
  return (
    <div className={`ah-subagent is-${s.status}`} id={subDomId(row.id)}>
      <button type="button" className="ah-btn ah-subagent-head" aria-expanded={open} onClick={() => toggleSub(row.id)} title={row.prompt}>
        <span className="ah-sub">{open ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>
        <SubStatusIcon status={s.status} />
        <AgentIcon className="ah-sub" />
        <span className="ah-subagent-title ah-ellipsis">{s.description}</span>
        <span className="ah-sub ah-small ah-ellipsis">{now || subFacts(s)}</span>
      </button>
      {open && (
        <div className="ah-subagent-body">
          {now && <div className="ah-sub ah-small">{subFacts(s)}</div>}
          {row.prompt && (
            <div className="ah-thinking">
              <button type="button" className="ah-btn ah-thinking-head" aria-expanded={showPrompt} onClick={() => setShowPrompt((o) => !o)}>
                {showPrompt ? <ChevronDownIcon /> : <ChevronRightIcon />}
                <span>Prompt</span>
                {!showPrompt && <span className="ah-ellipsis ah-sub">{row.prompt.split('\n')[0]}</span>}
              </button>
              {showPrompt && <div className="ah-thinking-body">{row.prompt}</div>}
            </div>
          )}
          {row.children.length === 0 && <div className="ah-sub ah-small">{s.status === 'running' ? 'Working…' : 'No tool calls.'}</div>}
          <Blocks blocks={childBlocks} agent={agent} openSubs={openSubs} toggleSub={toggleSub} />
          {row.result && <pre className={`ah-pre ah-subagent-result ${row.status === 'error' ? 'is-error' : ''}`}>{row.result}</pre>}
        </div>
      )}
    </div>
  );
}

/** Compact badges of the session's subagents, above the composer. */
function SubagentStrip({ subagents, onPick }: { subagents: SubagentInfo[]; onPick: (toolUseId: string) => void }) {
  const t = subagentTally(subagents);
  return (
    <div className="ah-substrip" role="list" aria-label={`Subagents: ${t.text}`}>
      <span className="ah-substrip-label" title={t.text}>
        <AgentIcon /> {t.total}
      </span>
      {subagents.map((s) => (
        <button
          key={s.toolUseId}
          type="button"
          role="listitem"
          className={`ah-btn ah-subchip is-${s.status}`}
          onClick={() => onPick(s.toolUseId)}
          title={`${s.description} — ${s.status}${s.activity ? `: ${s.activity}` : ''}\n${subFacts(s)}`}
        >
          <SubStatusIcon status={s.status} />
          <span className="ah-ellipsis">{s.description}</span>
        </button>
      ))}
    </div>
  );
}
const Thinking = memo(function Thinking({ text }: { text: string }) {
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
});

function ToolStatusIcon({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') return <span className="ah-spinner" aria-label="Running" />;
  if (status === 'error') return <CriticalIcon className="ah-ic-critical" aria-label="Failed" />;
  return <CheckmarkIcon className="ah-ic-success" aria-label="Succeeded" />;
}

const ToolRow = memo(function ToolRow({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
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
});

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
              <Option
                key={o.label}
                multi={multi}
                checked={c.picked.includes(o.label)}
                disabled={sent}
                label={o.label}
                description={o.description}
                onClick={() => set(i, toggleChoice(c, o.label, multi))}
              />
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

function Composer({ agent, real, session }: { agent: Agent; real: boolean; session: ClaudeSession | undefined }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const catalog = useClaudeCatalog().data;
  const status = agent.data.status;
  const running = status === 'running';
  const asking = !!agent.data.pendingQuestion;
  const options = slash ? slashOptions(slash.query, SKILLS, session?.commands ?? catalog?.commands) : [];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const refreshSlash = (value: string, pos: number) => {
    const m = value.slice(0, pos).match(/(^|\s)\/([\w:-]*)$/);
    setSlash(m ? { start: pos - (m[2] ?? '').length - 1, query: m[2] ?? '' } : null);
    setActive(0);
  };
  const accept = (i: number) => {
    const o = options[i];
    if (!o || !slash) return;
    const insert = `/${o.name} `;
    const next = text.slice(0, slash.start) + insert + text.slice(slash.start + 1 + slash.query.length);
    setText(next);
    setSlash(null);
    const pos = slash.start + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const t = text.trim();
    if (!t || !agent.data.localId || sending) return;
    setSending(true);
    setSlash(null);
    try {
      await claudeOps.send(agent.data.localId, t);
      setText('');
    } catch (e) {
      toast('Could not send the message', errorText(e), 'critical');
    } finally {
      setSending(false);
    }
  };

  const configure = async (p: { model?: string; effort?: ClaudeEffort | ''; permissionMode?: PermissionValue }) => {
    if (!agent.data.localId) return;
    const req: ClaudeConfigureRequest = {
      ...(p.model !== undefined ? { model: p.model || null } : {}),
      ...(p.effort !== undefined ? { effort: p.effort || null } : {}),
      ...(p.permissionMode !== undefined ? { permissionMode: p.permissionMode } : {}),
    };
    try {
      const r = await claudeOps.configure(agent.data.localId, req);
      patchData<'agent'>(agent, {
        ...(p.effort !== undefined ? { effort: p.effort || undefined } : {}),
        ...(p.permissionMode !== undefined ? { permissionMode: p.permissionMode === 'default' ? undefined : p.permissionMode } : {}),
      });
      const msg = configureMessage(r);
      toast(msg.title, msg.message, 'info');
    } catch (e) {
      toast('Could not change the session', errorText(e), 'critical');
    }
  };

  const placeholder = !real
    ? 'Demo agent: no session to talk to'
    : asking
      ? 'Answer above, or type your answer here…'
      : running
        ? 'Claude is working. Send a message to steer it…'
        : 'Reply to Claude… / for commands';
  return (
    <div className="ah-composer">
      {slash && options.length > 0 && (
        <div className="chat-popup ah-slash" role="listbox" aria-label="Commands and skills">
          <div className="chat-popup-head">Commands and skills</div>
          {options.map((o, i) => (
            <div
              key={o.name}
              role="option"
              aria-selected={i === active}
              className={`chat-option ${i === active ? 'is-active' : ''}`}
              onMouseDown={(e) => (e.preventDefault(), accept(i))}
              onMouseEnter={() => setActive(i)}
            >
              <span className="chat-option-icon">{o.source === 'cortex' ? skillIcon(o.name) : <TerminalIcon />}</span>
              <span className="chat-option-main">/{o.name}</span>
              <span className="chat-option-sub" title={o.desc}>
                {o.args ? `${o.args} · ${o.desc}` : o.desc}
              </span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={!real}
        placeholder={placeholder}
        aria-label="Message to the agent"
        onChange={(e) => {
          setText(e.target.value);
          refreshSlash(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => refreshSlash(text, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setSlash(null), 120)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (slash && options.length) {
            if (e.key === 'ArrowDown') return (e.preventDefault(), setActive((a) => (a + 1) % options.length));
            if (e.key === 'ArrowUp') return (e.preventDefault(), setActive((a) => (a - 1 + options.length) % options.length));
            if (e.key === 'Tab' || e.key === 'Enter') return (e.preventDefault(), accept(active));
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (slash) setSlash(null);
            else if (running) void interruptAgent(agent);
            else ref.current?.blur();
          }
        }}
      />
      <div className="ah-composer-bar">
        <SessionPickers
          label="This session"
          disabled={!real}
          pending={session?.restartPending}
          value={{
            model: session ? session.modelSetting : agent.data.model,
            effort: (session?.effort ?? agent.data.effort) as ClaudeEffort | undefined,
            permissionMode: session?.permissionMode ?? agent.data.permissionMode,
          }}
          onChange={(p) => void configure(p)}
        />
        <span className="ah-composer-buttons">
          {real && running && (
            <Button size="condensed" onClick={() => void interruptAgent(agent)} aria-label="Interrupt (Esc)">
              <Button.Prefix>
                <PauseIcon />
              </Button.Prefix>
              Esc
            </Button>
          )}
          {real && (running || status === 'waiting') && (
            <Button size="condensed" color="critical" onClick={() => void stopAgent(agent)} aria-label="Stop the session">
              <Button.Prefix>
                <StopIcon />
              </Button.Prefix>
            </Button>
          )}
          <Button
            variant="accent"
            color="primary"
            size="condensed"
            disabled={!real || !text.trim() || sending}
            loading={sending}
            onClick={() => void send()}
            aria-label={running ? 'Send (steers the running turn)' : 'Send'}
          >
            <Button.Prefix>
              <ArrowUpIcon />
            </Button.Prefix>
          </Button>
        </span>
      </div>
    </div>
  );
}

/** A terminal-like status bar: state │ model · effort · mode │ context meter │ tokens │ cache │ cost │ turns · time │ subagents. */
function StatusLine({ agent, session, subagents }: { agent: Agent; session: ClaudeSession | undefined; subagents: SubagentInfo[] }) {
  const ring = agentRing(agent)[0] ?? { tone: 'neutral' as const };
  const d = agent.data;
  const model = session?.model ?? d.model ?? (d.localId ? 'default model' : undefined);
  const effort = session?.effort ?? d.effort;
  const mode = permissionChoice(session?.permissionMode ?? d.permissionMode);
  const u = session ? usageView(session.usage) : undefined;
  // demo agents (and the canvas cache) only have the percent
  const pct = u?.contextPct ?? d.usage?.contextPct;
  const tone = pct != null ? contextTone(pct) : 'normal';
  const cost = u?.costUsd ?? d.usage?.costUsd;
  const turns = u?.turns ?? d.usage?.turns;
  const t = subagentTally(subagents);

  return (
    <div className="ah-status" role="status" aria-label="Session status">
      <Chip size="condensed" color={TONE_CHIP[ring.tone]} variant={ring.tone === 'neutral' ? undefined : 'emphasized'}>
        {STATUS_LABEL[d.status]}
      </Chip>
      {model && (
        <span className="ah-st" title={`Model in use${session?.modelSetting ? ` (chosen: ${session.modelSetting})` : ''}${session?.cliVersion ? ` · Claude Code ${session.cliVersion}` : ''}`}>
          <AIModelIcon />
          {modelLabel(model)}
          {effort && <span className="ah-sub">·{effort}</span>}
        </span>
      )}
      {mode.value !== 'default' && (
        <span className={`ah-st ${mode.tone ? `tone-${mode.tone}` : ''}`} title={`Permission mode: ${mode.label} — ${mode.hint}`}>
          <SecurityIcon />
          {mode.short}
        </span>
      )}
      {session?.restartPending?.length ? (
        <span className="ah-st tone-warning" title={`${session.restartPending.join(', ')} applies with the next message (the CLI restarts with --resume)`}>
          restart pending
        </span>
      ) : null}
      {pct != null && (
        <>
          <span className="ah-st-sep" aria-hidden />
          <span
            className={`ah-ctx tone-${tone}`}
            title={
              u
                ? `Context: ${u.contextTokens.toLocaleString()} of ${u.contextWindow.toLocaleString()} tokens${u.windowGuessed ? ' (window assumed until the first turn ends)' : ''}${tone !== 'normal' ? ' — nearly full; Claude Code compacts automatically, or send /compact' : ''}`
                : 'Context window in use'
            }
          >
            <span className="ah-ctx-bar" aria-hidden>
              <span style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            {u ? `${tokens(u.contextTokens)}/${tokens(u.contextWindow)}${u.windowGuessed ? '?' : ''}` : ''} {pct}%
          </span>
        </>
      )}
      {u && u.input + u.output + u.cacheRead > 0 && (
        <>
          <span className="ah-st-sep" aria-hidden />
          <span className="ah-st" title={`Tokens this session (subagents included): ${u.input.toLocaleString()} input (uncached), ${u.output.toLocaleString()} output`}>
            <TokenIcon />↑{tokens(u.input + u.cacheRead + u.cacheWrite)} ↓{tokens(u.output)}
          </span>
          <span
            className={`ah-st ${u.lastHitPct != null && u.lastHitPct < 50 && u.turns > 0 ? 'tone-warning' : ''}`}
            title={`Prompt cache — latest call: ${u.lastHitPct ?? '–'}% read from cache. Session: ${u.cacheRead.toLocaleString()} read, ${u.cacheWrite.toLocaleString()} written, ${u.input.toLocaleString()} uncached (${u.totalHitPct ?? '–'}% hit)`}
          >
            <DatabaseIcon />
            {u.lastHitPct != null ? `${u.lastHitPct}%` : '–'}
          </span>
        </>
      )}
      {cost != null && cost > 0 && (
        <span className="ah-st" title="Cost of this session so far (USD, as reported by the CLI)">
          {usd(cost)}
        </span>
      )}
      {turns != null && turns > 0 && (
        <span className="ah-st" title={u?.durationMs ? `Turns · time Claude worked (last turn ${duration(session?.usage.lastTurnMs ?? 0)})` : 'Finished turns'}>
          {turns === 1 ? '1 turn' : `${turns} turns`}
          {u?.durationMs ? ` · ${duration(u.durationMs)}` : ''}
        </span>
      )}
      {t.total > 0 && (
        <span className={`ah-st ${t.running ? 'is-live' : ''}`} title={`Subagents: ${t.text}`}>
          <AgentIcon />
          {t.running ? `${t.running}/${t.total}` : t.total}
        </span>
      )}
      {d.status !== 'running' && d.lastActivity && (
        <span className="ah-ellipsis" title={d.lastActivity}>
          {d.lastActivity}
        </span>
      )}
    </div>
  );
}
const STATUS_LABEL: Record<Agent['data']['status'], string> = { running: 'Running', waiting: 'Waiting for you', idle: 'Idle', done: 'Done', failed: 'Failed' };
