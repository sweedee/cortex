/**
 * Claude Code headless sessions: the stream-json wire types (`claude -p --output-format stream-json
 * --input-format stream-json --verbose`, verified against Claude Code 2.1.323) and a pure reducer
 * that folds events into a session. Ported from the `prototype` branch's mapper. Dependency free:
 * the renderer can replay `claude:transcript` with the same reducer main uses.
 */

export const ASK_TOOL = 'AskUserQuestion';

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean };

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AskQuestion {
  question: string;
  /** short chip label, e.g. "Approach" */
  header: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
}

/**
 * One stdout line of stream-json (the subset Cortex reads; unknown types are kept in the
 * transcript and ignored by the reducer). `timestamp` is stamped by main on arrival.
 */
export type ClaudeEvent = { timestamp?: string } & (
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; cwd?: string; permissionMode?: string; tools?: string[] }
  | { type: 'system'; subtype: string; session_id?: string; [k: string]: unknown }
  | { type: 'assistant'; session_id: string; parent_tool_use_id?: string | null; message: { id?: string; model?: string; content: ClaudeContentBlock[]; usage?: ClaudeUsage } }
  | { type: 'user'; session_id: string; parent_tool_use_id?: string | null; message: { role?: 'user'; content: ClaudeContentBlock[] | string } }
  | { type: 'stream_event'; session_id: string; event: { type: string; delta?: { type: string; text?: string } } }
  | {
      type: 'result';
      session_id: string;
      subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | string;
      is_error: boolean;
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      num_turns?: number;
      usage?: ClaudeUsage;
    }
  /** permission prompt / AskUserQuestion routed to the host (`--permission-prompt-tool stdio`) */
  | { type: 'control_request'; request_id: string; request: ClaudeControlRequest }
  | { type: 'control_response'; response: { subtype: 'success' | 'error'; request_id: string; response?: unknown; error?: string } }
);

export type ClaudeControlRequest =
  | { subtype: 'can_use_tool'; tool_name: string; input: Record<string, unknown>; tool_use_id?: string; decision_reason?: string; blocked_path?: string }
  | { subtype: string; [k: string]: unknown };

/** Answers to an AskUserQuestion: question text → option label(s) or free text. */
export type ClaudeAnswers = Record<string, string | string[]>;

export type ClaudeSessionStatus =
  /** process spawned, no `system/init` yet */
  | 'starting'
  /** working on a turn */
  | 'running'
  /** blocked on the user: an AskUserQuestion or a permission prompt */
  | 'waiting'
  /** turn finished, process alive and ready for the next message */
  | 'idle'
  /** no process attached (stopped, exited cleanly, or restored after an app restart) */
  | 'done'
  | 'failed';

export type SessionMessage =
  | { id: string; role: 'user' | 'assistant'; at: string; text: string }
  | {
      id: string;
      role: 'tool';
      at: string;
      tool: string;
      summary: string;
      status: 'running' | 'ok' | 'error';
      detail?: string;
      questions?: AskQuestion[];
      answers?: Record<string, string>;
    };

export interface SessionUsage {
  /** tokens in the context window after the latest API call */
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** `total_cost_usd` of the current process so far (cumulative per process; reset on respawn) */
  processCostUsd?: number;
  /** completed turns (result events) */
  turns: number;
  lastTurnMs?: number;
  lastMessageId?: string;
}

export interface PendingPermission {
  requestId: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  reason?: string;
}

/** What `claude:state` carries (no messages; get those with `claude:transcript`). */
export interface ClaudeSessionSummary {
  localId: string;
  /** Claude's own session id (known after `system/init`, or the resumed id) */
  sessionId?: string;
  cwd: string;
  title: string;
  model?: string;
  /** `--permission-mode` the session runs with (unset = the CLI's default) */
  permissionMode?: string;
  status: ClaudeSessionStatus;
  /** "Editing src/x.ts", "Has a question for you", … */
  activity?: string;
  /** the latest assistant text */
  lastText?: string;
  pendingQuestion?: { toolUseId: string; questions: AskQuestion[] };
  pendingPermissions: PendingPermission[];
  usage: SessionUsage;
  /** a process is attached */
  running: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeSession extends ClaudeSessionSummary {
  messages: SessionMessage[];
}

export const NO_USAGE: SessionUsage = { contextTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, turns: 0 };

export function newSession(init: { localId: string; cwd: string; title: string; sessionId?: string; model?: string; permissionMode?: string; at?: string }): ClaudeSession {
  const at = init.at ?? new Date().toISOString();
  return {
    localId: init.localId,
    sessionId: init.sessionId,
    cwd: init.cwd,
    title: init.title,
    model: init.model,
    ...(init.permissionMode ? { permissionMode: init.permissionMode } : {}),
    status: 'starting',
    pendingPermissions: [],
    usage: NO_USAGE,
    running: true,
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
}

export const toSummary = ({ messages: _m, ...s }: ClaudeSession): ClaudeSessionSummary => s;

// ---- helpers ------------------------------------------------------------------------

const VERBS: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Bash: 'Running',
  PowerShell: 'Running',
  Grep: 'Searching for',
  Glob: 'Finding',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web for',
  Task: 'Delegating:',
  Agent: 'Delegating:',
  TodoWrite: 'Updating the task list',
};

/** The one argument worth showing for a tool call. */
export function toolSummary(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'url', 'query', 'description', 'path']) {
    const v = input[key];
    if (typeof v === 'string') return v;
  }
  const first = Object.values(input).find((v) => typeof v === 'string');
  return typeof first === 'string' ? first : '';
}

const activityOf = (tool: string, summary: string) => `${VERBS[tool] ?? tool} ${summary}`.trim();

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: { text?: string }) => c?.text ?? '').join('\n');
  return '';
}

/** AskUserQuestion input → questions (defensive: it comes straight from the model). */
export function parseQuestions(input: Record<string, unknown>): AskQuestion[] {
  const raw = Array.isArray(input['questions']) ? (input['questions'] as Record<string, unknown>[]) : [];
  return raw
    .filter((q) => typeof q?.['question'] === 'string')
    .map((q) => ({
      question: q['question'] as string,
      header: typeof q['header'] === 'string' ? q['header'] : '',
      multiSelect: q['multiSelect'] === true,
      options: (Array.isArray(q['options']) ? (q['options'] as Record<string, unknown>[]) : [])
        .filter((o) => typeof o?.['label'] === 'string')
        .map((o) => ({ label: o['label'] as string, description: typeof o['description'] === 'string' ? o['description'] : undefined })),
    }));
}

const unquote = (s: string) => s.replace(/\\"/g, '"');

/** The AskUserQuestion tool_result reads `… "<question>"="<answer>", … .` */
export function parseAnswers(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)) out[unquote(m[1])] = unquote(m[2]);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Answers in the wire shape AskUserQuestion's `answers` input takes: multi-select joined with ", ". */
export const flattenAnswers = (a: ClaudeAnswers): Record<string, string> =>
  Object.fromEntries(Object.entries(a).map(([q, v]) => [q, Array.isArray(v) ? v.join(', ') : v]));

/** The fallback: answers as a plain user message (when the tool could not be answered in-band). */
export const answersAsText = (a: ClaudeAnswers) =>
  `My answers to your questions:\n${Object.entries(flattenAnswers(a))
    .map(([q, v]) => `- ${q} → ${v}`)
    .join('\n')}`;

function addUsage(prev: SessionUsage, id: string | undefined, u: ClaudeUsage): SessionUsage {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const repeat = id !== undefined && id === prev.lastMessageId; // same API message, another content block
  return {
    ...prev,
    contextTokens: u.input_tokens + read + write,
    lastMessageId: id,
    ...(repeat
      ? {}
      : {
          inputTokens: prev.inputTokens + u.input_tokens,
          outputTokens: prev.outputTokens + u.output_tokens,
          cacheReadTokens: prev.cacheReadTokens + read,
          cacheWriteTokens: prev.cacheWriteTokens + write,
        }),
  };
}

const QUESTION_ACTIVITY = 'Has a question for you';

function openQuestion(messages: SessionMessage[]): { toolUseId: string; questions: AskQuestion[] } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'tool' && m.tool === ASK_TOOL && m.status === 'running') return { toolUseId: m.id, questions: m.questions ?? [] };
  }
  return undefined;
}

/** status to show once nothing is pending */
const settle = (s: ClaudeSession): ClaudeSession => {
  const q = openQuestion(s.messages);
  if (q || s.pendingPermissions.length > 0) {
    return { ...s, pendingQuestion: q, status: 'waiting', activity: q ? QUESTION_ACTIVITY : `Wants to use ${s.pendingPermissions[0].toolName}` };
  }
  return { ...s, pendingQuestion: undefined, status: s.status === 'waiting' ? 'running' : s.status };
};

// ---- reducer ----------------------------------------------------------------------

/** Folds one event into the session. Pure. Unknown events only bump `updatedAt`. */
export function applyClaudeEvent(session: ClaudeSession, event: ClaudeEvent): ClaudeSession {
  const at = event.timestamp ?? new Date().toISOString();
  let messages = session.messages;
  const nextId = () => `${session.localId}-m${messages.length + 1}`;
  const base = { ...session, updatedAt: at };

  switch (event.type) {
    case 'system': {
      if (event.subtype !== 'init') return base;
      const e = event as { session_id: string; model: string; permissionMode?: string };
      return { ...base, sessionId: e.session_id ?? session.sessionId, model: e.model ?? session.model, permissionMode: e.permissionMode ?? session.permissionMode, status: session.status === 'waiting' ? 'waiting' : 'running' };
    }

    case 'stream_event': {
      const text = event.event.type === 'content_block_delta' && event.event.delta?.type === 'text_delta' ? (event.event.delta.text ?? '') : '';
      if (!text) return base;
      const last = messages[messages.length - 1];
      messages =
        last?.role === 'assistant' && last.id.endsWith('-draft')
          ? [...messages.slice(0, -1), { ...last, text: last.text + text }]
          : [...messages, { id: nextId() + '-draft', role: 'assistant', at, text }];
      return { ...base, messages, status: 'running', activity: 'Writing…' };
    }

    case 'assistant': {
      // subagent output (parent_tool_use_id set) only shows as activity of the parent Task
      if (event.parent_tool_use_id) return base;
      let activity = session.activity;
      let lastText = session.lastText;
      for (const b of event.message.content ?? []) {
        if (b.type === 'text') {
          const last = messages[messages.length - 1];
          if (last?.role === 'assistant' && last.id.endsWith('-draft')) {
            messages = [...messages.slice(0, -1), { ...last, id: last.id.slice(0, -'-draft'.length), text: b.text }];
          } else {
            messages = [...messages, { id: nextId(), role: 'assistant', at, text: b.text }];
          }
          lastText = b.text;
          activity = 'Thinking…';
        } else if (b.type === 'tool_use') {
          if (b.name === ASK_TOOL) {
            const questions = parseQuestions(b.input ?? {});
            messages = [...messages, { id: b.id, role: 'tool', at, tool: ASK_TOOL, summary: questions[0]?.question ?? '', status: 'running', questions }];
            continue;
          }
          const summary = toolSummary(b.input ?? {});
          messages = [...messages, { id: b.id, role: 'tool', at, tool: b.name, summary, status: 'running' }];
          activity = activityOf(b.name, summary);
        }
      }
      const usage = event.message.usage ? addUsage(session.usage, event.message.id, event.message.usage) : session.usage;
      return settle({ ...base, messages, usage, lastText, status: 'running', activity, model: event.message.model ?? session.model });
    }

    case 'user': {
      if (event.parent_tool_use_id) return base;
      const content = event.message.content;
      if (typeof content === 'string') return { ...base, messages: [...messages, { id: nextId(), role: 'user', at, text: content }] };
      const results = new Map<string, Extract<ClaudeContentBlock, { type: 'tool_result' }>>();
      const texts: string[] = [];
      for (const b of content) {
        if (b.type === 'tool_result') results.set(b.tool_use_id, b);
        else if (b.type === 'text') texts.push(b.text);
      }
      messages = messages.map((m) => {
        const r = m.role === 'tool' ? results.get(m.id) : undefined;
        if (!r || m.role !== 'tool') return m;
        const status = r.is_error ? 'error' : 'ok';
        const text = resultText(r.content);
        if (m.tool === ASK_TOOL) return { ...m, status, answers: r.is_error ? undefined : parseAnswers(text), detail: r.is_error ? text : undefined };
        return { ...m, status, detail: text || undefined };
      });
      if (texts.length > 0) messages = [...messages, { id: nextId(), role: 'user', at, text: texts.join('\n') }];
      // the permission prompt for an answered tool is gone too
      const pendingPermissions = session.pendingPermissions.filter((p) => !p.toolUseId || !results.has(p.toolUseId));
      return settle({ ...base, messages, pendingPermissions, activity: results.size ? 'Thinking…' : session.activity });
    }

    case 'result': {
      const u = session.usage;
      const usage: SessionUsage = {
        ...u,
        // total_cost_usd is cumulative for the process: add only what this turn added
        costUsd: event.total_cost_usd !== undefined ? u.costUsd - (u.processCostUsd ?? 0) + event.total_cost_usd : u.costUsd,
        processCostUsd: event.total_cost_usd ?? u.processCostUsd,
        turns: u.turns + 1,
        lastTurnMs: event.duration_ms ?? u.lastTurnMs,
      };
      messages = messages.map((m) => (m.role === 'tool' && m.status === 'running' ? { ...m, status: event.is_error ? 'error' : 'ok' } : m));
      const s: ClaudeSession = {
        ...base,
        messages,
        usage,
        pendingQuestion: undefined,
        pendingPermissions: [],
        lastText: event.result || session.lastText,
        activity: undefined,
        status: event.is_error ? 'failed' : 'idle',
        error: event.is_error ? event.result || event.subtype : undefined,
      };
      return s;
    }

    case 'control_request': {
      const r = event.request;
      if (r.subtype !== 'can_use_tool') return base;
      const req = r as Extract<ClaudeControlRequest, { subtype: 'can_use_tool' }>;
      // AskUserQuestion shows as the question card; everything else as a permission prompt
      if (req.tool_name === ASK_TOOL) return base;
      const p: PendingPermission = { requestId: event.request_id, toolName: req.tool_name, toolUseId: req.tool_use_id, input: req.input ?? {}, reason: req.decision_reason };
      return settle({ ...base, pendingPermissions: [...session.pendingPermissions.filter((x) => x.requestId !== p.requestId), p] });
    }

    default:
      return base;
  }
}

/** Replays a transcript. `running` = a process is attached. */
export function replayTranscript(session: ClaudeSession, events: ClaudeEvent[], running: boolean): ClaudeSession {
  const s = events.reduce(applyClaudeEvent, { ...session, running });
  if (!running && (s.status === 'running' || s.status === 'starting' || s.status === 'idle' || s.status === 'waiting'))
    return { ...s, status: 'done', activity: undefined, pendingPermissions: [], pendingQuestion: undefined };
  return s;
}

/** Parse one stdout line; null for blank / non-JSON lines (e.g. stray warnings). */
export function parseStreamLine(line: string): ClaudeEvent | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    const v = JSON.parse(t) as unknown;
    return v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string' ? (v as ClaudeEvent) : null;
  } catch {
    return null;
  }
}

// ---- requests --------------------------------------------------------------------

export interface ClaudeStartRequest {
  /** absolute working directory */
  cwd: string;
  /** first user message; optional when resuming */
  prompt?: string;
  title?: string;
  /** `--model` (alias like `opus` or a full id) */
  model?: string;
  /** `--effort` low | medium | high | xhigh | max */
  effort?: string;
  /** `--permission-mode` */
  permissionMode?: 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk' | 'plan' | 'default';
  /** `--resume <session id>` */
  resume?: string;
  /** `--add-dir` */
  addDirs?: string[];
  /** `--append-system-prompt` */
  appendSystemPrompt?: string;
  /** reuse a local id (e.g. resuming a persisted session after an app restart) */
  localId?: string;
}

export interface ClaudeEventMessage {
  localId: string;
  event: ClaudeEvent;
}

export type ClaudePermissionDecision = { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message?: string };
