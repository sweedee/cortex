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

/** per-model numbers in a `result` event (`modelUsage`, `model_usage_since_last_result`) */
export interface ClaudeModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/** A slash command / skill the CLI offers (from the `initialize` control response). */
export interface ClaudeCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

/** A model choice the CLI offers (from the `initialize` control response). */
export interface ClaudeModelOption {
  /** alias or id to pass as `--model` / `set_model` (`default` = the CLI's default) */
  value: string;
  displayName?: string;
  description?: string;
  resolvedModel?: string;
  supportedEffortLevels?: string[];
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
  | { type: 'user'; session_id: string; parent_tool_use_id?: string | null; isReplay?: boolean; message: { role?: 'user'; content: ClaudeContentBlock[] | string } }
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
      /** cumulative per process, per model */
      modelUsage?: Record<string, ClaudeModelUsage>;
      /** what this turn added, per model (subagents included) */
      model_usage_since_last_result?: Record<string, ClaudeModelUsage>;
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
  /** `parent` = the Task / Agent tool use of the subagent that wrote it (unset = the main thread) */
  | { id: string; role: 'user' | 'assistant'; at: string; text: string; parent?: string }
  /** a CLI notice, e.g. the echo of a live model switch ("Set model to sonnet") */
  | { id: string; role: 'note'; at: string; text: string; parent?: undefined }
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
      parent?: string;
    };

export type SubagentStatus = 'running' | 'done' | 'failed' | 'stopped';

/** A subagent the session spawned (a `Task` / `Agent` tool use, plus the CLI's `system/task_*` events). */
export interface SubagentInfo {
  /** the Task / Agent tool_use id; the subagent's messages carry it as `parent_tool_use_id` */
  toolUseId: string;
  taskId?: string;
  /** the tool use of the subagent that spawned this one (nested subagents) */
  parent?: string;
  description: string;
  /** `subagent_type`, e.g. `general-purpose`, `Explore` */
  type?: string;
  background?: boolean;
  status: SubagentStatus;
  startedAt: string;
  endedAt?: string;
  toolUses: number;
  /** total tokens it used (from `task_progress` / `task_notification`) */
  tokens?: number;
  durationMs?: number;
  lastTool?: string;
  /** what it is doing now ("Finding *.txt") */
  activity?: string;
}

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
  /** sum of the turns' `duration_ms` */
  durationMs?: number;
  /** the model's context window (`result.modelUsage[…].contextWindow`); unknown before the first result */
  contextWindow?: number;
  /** the latest main-thread API call: what the context is made of (cache hit = cacheRead / (input + cacheRead + cacheWrite)) */
  last?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /** recent assistant message ids already counted (a message arrives once per content block) */
  seenIds?: string[];
  /** the totals when the current turn started; the result's per-turn numbers replace what was summed since */
  turnBase?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
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
  /** `--effort` (unset = the CLI's default) */
  effort?: string;
  /** settings the running process could not take live; the next message restarts it with `--resume` */
  restartPending?: string[];
  status: ClaudeSessionStatus;
  /** "Editing src/x.ts", "Has a question for you", … */
  activity?: string;
  /** the latest assistant text */
  lastText?: string;
  pendingQuestion?: { toolUseId: string; questions: AskQuestion[] };
  pendingPermissions: PendingPermission[];
  usage: SessionUsage;
  /** subagents spawned in this session, in start order */
  subagents: SubagentInfo[];
  cliVersion?: string;
  /** a process is attached */
  running: boolean;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** The full session (`claude:session`): the summary plus what is too big to push with every state event. */
export interface ClaudeSession extends ClaudeSessionSummary {
  messages: SessionMessage[];
  /** slash commands / skills the CLI offers (from `initialize`) */
  commands?: ClaudeCommand[];
  /** models the CLI offers (from `initialize`) */
  models?: ClaudeModelOption[];
}

/** What the CLI offers (`claude:catalog`): the latest `initialize` answer of any session, or of a probe. */
export interface ClaudeCatalog {
  commands: ClaudeCommand[];
  models: ClaudeModelOption[];
  cliVersion?: string;
}

export const NO_USAGE: SessionUsage = { contextTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, turns: 0 };

export function newSession(init: { localId: string; cwd: string; title: string; sessionId?: string; model?: string; permissionMode?: string; effort?: string; at?: string }): ClaudeSession {
  const at = init.at ?? new Date().toISOString();
  return {
    localId: init.localId,
    sessionId: init.sessionId,
    cwd: init.cwd,
    title: init.title,
    model: init.model,
    ...(init.permissionMode ? { permissionMode: init.permissionMode } : {}),
    ...(init.effort ? { effort: init.effort } : {}),
    status: 'starting',
    pendingPermissions: [],
    usage: NO_USAGE,
    subagents: [],
    running: true,
    createdAt: at,
    updatedAt: at,
    messages: [],
  };
}

export const toSummary = ({ messages: _m, commands: _c, models: _o, ...s }: ClaudeSession): ClaudeSessionSummary => s;

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

type Totals = NonNullable<SessionUsage['turnBase']>;
const totalsOf = (u: SessionUsage): Totals => ({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens });

/**
 * One assistant message's usage. Totals count every API call once (subagents included); the
 * context size and its make-up only follow the main thread (a subagent has its own context).
 */
function addUsage(prev: SessionUsage, id: string | undefined, u: ClaudeUsage, mainThread: boolean): SessionUsage {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const seen = prev.seenIds ?? [];
  const repeat = id !== undefined && seen.includes(id); // same API message, another content block
  const next: SessionUsage = { ...prev, turnBase: prev.turnBase ?? totalsOf(prev), seenIds: id && !repeat ? [...seen.slice(-15), id] : seen };
  if (mainThread) {
    next.contextTokens = u.input_tokens + read + write;
    next.last = { input: u.input_tokens, cacheRead: read, cacheWrite: write, output: u.output_tokens };
  }
  if (repeat) return next;
  return {
    ...next,
    inputTokens: prev.inputTokens + u.input_tokens,
    outputTokens: prev.outputTokens + u.output_tokens,
    cacheReadTokens: prev.cacheReadTokens + read,
    cacheWriteTokens: prev.cacheWriteTokens + write,
  };
}

/** A `result` event: the turn's authoritative per-model numbers replace what was summed during it. */
function resultUsage(u: SessionUsage, e: Extract<ClaudeEvent, { type: 'result' }>, model: string | undefined): SessionUsage {
  const delta = e.model_usage_since_last_result;
  let totals = totalsOf(u);
  if (delta && Object.keys(delta).length) {
    const b = u.turnBase ?? totals;
    const sum = (k: keyof ClaudeModelUsage) => Object.values(delta).reduce((n, m) => n + (Number(m[k]) || 0), 0);
    totals = {
      inputTokens: b.inputTokens + sum('inputTokens'),
      outputTokens: b.outputTokens + sum('outputTokens'),
      cacheReadTokens: b.cacheReadTokens + sum('cacheReadInputTokens'),
      cacheWriteTokens: b.cacheWriteTokens + sum('cacheCreationInputTokens'),
    };
  }
  const per = e.modelUsage ?? delta ?? {};
  const windows = Object.values(per).map((m) => m.contextWindow ?? 0).filter((n) => n > 0);
  const contextWindow = (model && per[model]?.contextWindow) || (windows.length ? Math.max(...windows) : undefined) || u.contextWindow;
  return {
    ...u,
    ...totals,
    turnBase: undefined,
    contextWindow,
    // total_cost_usd is cumulative for the process: add only what this turn added
    costUsd: e.total_cost_usd !== undefined ? u.costUsd - (u.processCostUsd ?? 0) + e.total_cost_usd : u.costUsd,
    processCostUsd: e.total_cost_usd ?? u.processCostUsd,
    turns: u.turns + 1,
    lastTurnMs: e.duration_ms ?? u.lastTurnMs,
    durationMs: (u.durationMs ?? 0) + (e.duration_ms ?? 0),
  };
}

/** Tools that spawn a subagent. */
export const isSubagentTool = (name: string) => name === 'Task' || name === 'Agent';

const subStatus = (s: unknown): SubagentStatus | undefined =>
  s === 'completed' || s === 'done' || s === 'success' ? 'done' : s === 'failed' || s === 'error' ? 'failed' : s === 'killed' || s === 'stopped' || s === 'cancelled' ? 'stopped' : s === 'running' ? 'running' : undefined;

function patchSub(list: SubagentInfo[], match: (s: SubagentInfo) => boolean, patch: Partial<SubagentInfo>): SubagentInfo[] {
  const i = list.findIndex(match);
  if (i < 0) return list;
  const prev = list[i];
  // a finished subagent stays finished (late progress events)
  const next = prev.status !== 'running' && patch.status === 'running' ? { ...prev, ...patch, status: prev.status } : { ...prev, ...patch };
  return [...list.slice(0, i), next, ...list.slice(i + 1)];
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** `system/task_*` events → the subagent list. */
function applyTaskEvent(subs: SubagentInfo[], e: Record<string, unknown>, at: string): SubagentInfo[] {
  const toolUseId = str(e['tool_use_id']);
  const taskId = str(e['task_id']);
  const match = (s: SubagentInfo) => (!!toolUseId && s.toolUseId === toolUseId) || (!!taskId && s.taskId === taskId);
  const usage = (e['usage'] ?? {}) as Record<string, unknown>;
  const stats: Partial<SubagentInfo> = {
    ...(num(usage['tool_uses']) !== undefined ? { toolUses: num(usage['tool_uses']) } : {}),
    ...(num(usage['total_tokens']) !== undefined ? { tokens: num(usage['total_tokens']) } : {}),
    ...(num(usage['duration_ms']) !== undefined ? { durationMs: num(usage['duration_ms']) } : {}),
  };
  switch (e['subtype']) {
    case 'task_started': {
      if (!subs.some(match)) {
        if (!toolUseId) return subs;
        return [...subs, { toolUseId, taskId, description: str(e['description']) ?? 'Subagent', type: str(e['subagent_type']), background: e['is_backgrounded'] === true, status: 'running', startedAt: at, toolUses: 0 }];
      }
      return patchSub(subs, match, { taskId, ...(str(e['subagent_type']) ? { type: str(e['subagent_type']) } : {}), ...(e['is_backgrounded'] === true ? { background: true } : {}) });
    }
    case 'task_progress':
      return patchSub(subs, match, { ...stats, ...(str(e['last_tool_name']) ? { lastTool: str(e['last_tool_name']) } : {}), ...(str(e['description']) ? { activity: str(e['description']) } : {}) });
    case 'task_updated': {
      const status = subStatus(((e['patch'] ?? {}) as Record<string, unknown>)['status']);
      return status ? patchSub(subs, match, { status, ...(status !== 'running' ? { endedAt: at, activity: undefined } : {}) }) : subs;
    }
    case 'task_notification': {
      const status = subStatus(e['status']);
      return patchSub(subs, match, { ...stats, ...(status ? { status, ...(status !== 'running' ? { endedAt: at, activity: undefined } : {}) } : {}) });
    }
    default:
      return subs;
  }
}

/** `<local-command-stdout>Set model to …</local-command-stdout>` → the text inside (undefined = not such a message) */
export function localCommandOutput(text: string): string | undefined {
  const m = text.match(/^\s*<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>\s*$/);
  return m ? m[1].replace(/`/g, '').trim() : undefined;
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

function parseCommands(v: unknown): ClaudeCommand[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return (v as Record<string, unknown>[])
    .filter((c) => typeof c?.['name'] === 'string')
    .map((c) => ({ name: c['name'] as string, ...(str(c['description']) ? { description: str(c['description']) } : {}), ...(str(c['argumentHint']) ? { argumentHint: str(c['argumentHint']) } : {}) }));
}

function parseModels(v: unknown): ClaudeModelOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return (v as Record<string, unknown>[])
    .filter((m) => typeof m?.['value'] === 'string')
    .map((m) => ({
      value: m['value'] as string,
      ...(str(m['displayName']) ? { displayName: str(m['displayName']) } : {}),
      ...(str(m['description']) ? { description: str(m['description']) } : {}),
      ...(str(m['resolvedModel']) ? { resolvedModel: str(m['resolvedModel']) } : {}),
      ...(Array.isArray(m['supportedEffortLevels']) ? { supportedEffortLevels: (m['supportedEffortLevels'] as unknown[]).filter((x): x is string => typeof x === 'string') } : {}),
    }));
}

/** The `initialize` control response → what the CLI offers (null = not such a response). */
export function catalogOf(response: unknown): ClaudeCatalog | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  const commands = parseCommands(r['commands']);
  const models = parseModels(r['models']);
  if (!commands && !models) return null;
  return { commands: commands ?? [], models: models ?? [], ...(str(r['claude_code_version']) ? { cliVersion: str(r['claude_code_version']) } : {}) };
}

// ---- reducer ----------------------------------------------------------------------

/** Folds one event into the session. Pure. Unknown events only bump `updatedAt`. */
export function applyClaudeEvent(session: ClaudeSession, event: ClaudeEvent): ClaudeSession {
  const at = event.timestamp ?? new Date().toISOString();
  let messages = session.messages;
  const nextId = () => `${session.localId}-m${messages.length + 1}`;
  const base = { ...session, updatedAt: at };
  const subs = session.subagents ?? [];

  switch (event.type) {
    case 'system': {
      const e = event as Record<string, unknown>;
      if (event.subtype === 'init') {
        const i = event as { session_id: string; model: string; permissionMode?: string };
        return { ...base, sessionId: i.session_id ?? session.sessionId, model: i.model ?? session.model, permissionMode: i.permissionMode ?? session.permissionMode, // the CLI re-sends init after a live model switch: that alone does not start a turn
          status: session.status === 'starting' || session.status === 'done' ? 'running' : session.status };
      }
      // a live permission-mode switch is confirmed with system/status {permissionMode}
      if (event.subtype === 'status') return typeof e['permissionMode'] === 'string' ? { ...base, permissionMode: e['permissionMode'] } : base;
      if (typeof event.subtype === 'string' && event.subtype.startsWith('task_')) {
        const subagents = applyTaskEvent(subs, e, at);
        if (subagents === subs) return base;
        const live = subagents.find((s) => s.status === 'running' && s.activity);
        return { ...base, subagents, ...(event.subtype === 'task_progress' && live && session.status === 'running' ? { activity: `${live.description} › ${live.activity}` } : {}) };
      }
      return base;
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
      // a subagent's output (parent_tool_use_id set) is nested under its Task / Agent tool call
      const parent = event.parent_tool_use_id || undefined;
      let activity = session.activity;
      let lastText = session.lastText;
      let subagents = subs;
      for (const b of event.message.content ?? []) {
        if (b.type === 'text') {
          if (parent) {
            if (b.text.trim()) messages = [...messages, { id: nextId(), role: 'assistant', at, text: b.text, parent }];
            continue;
          }
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
          const input = b.input ?? {};
          const summary = toolSummary(input);
          messages = [...messages, { id: b.id, role: 'tool', at, tool: b.name, summary, status: 'running', ...(parent ? { parent } : {}) }];
          if (isSubagentTool(b.name) && !subagents.some((s) => s.toolUseId === b.id)) {
            subagents = [
              ...subagents,
              { toolUseId: b.id, ...(parent ? { parent } : {}), description: str(input['description']) ?? summary ?? 'Subagent', type: str(input['subagent_type']), background: input['run_in_background'] === true, status: 'running', startedAt: at, toolUses: 0 },
            ];
          }
          if (parent) {
            const sub = subagents.find((s) => s.toolUseId === parent);
            subagents = patchSub(subagents, (s) => s.toolUseId === parent, { toolUses: (sub?.toolUses ?? 0) + 1, lastTool: b.name });
            activity = `${sub?.description ?? 'Subagent'} › ${activityOf(b.name, summary)}`;
          } else activity = activityOf(b.name, summary);
        }
      }
      const usage = event.message.usage ? addUsage(session.usage, event.message.id, event.message.usage, !parent) : session.usage;
      // a subagent may run on another model: only the main thread's says what the session uses
      const model = parent ? session.model : (event.message.model ?? session.model);
      return settle({ ...base, messages, usage, subagents, lastText, status: 'running', activity, model });
    }

    case 'user': {
      const parent = event.parent_tool_use_id || undefined;
      const content = event.message.content;
      if (typeof content === 'string') {
        if (parent) return base; // the subagent's prompt: shown as the Task tool's input
        const note = localCommandOutput(content);
        if (note !== undefined) return note ? { ...base, messages: [...messages, { id: nextId(), role: 'note', at, text: note }] } : base;
        if (event.isReplay) return base;
        return { ...base, messages: [...messages, { id: nextId(), role: 'user', at, text: content }] };
      }
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
      // a foreground subagent is over once its Task / Agent tool has a result (a background one only launched)
      let subagents = subs;
      for (const [id, r] of results) subagents = patchSub(subagents, (s) => s.toolUseId === id && s.status === 'running' && !s.background, { status: r.is_error ? 'failed' : 'done', endedAt: at, activity: undefined });
      if (texts.length > 0 && !parent && !event.isReplay) messages = [...messages, { id: nextId(), role: 'user', at, text: texts.join('\n') }];
      // the permission prompt for an answered tool is gone too
      const pendingPermissions = session.pendingPermissions.filter((p) => !p.toolUseId || !results.has(p.toolUseId));
      return settle({ ...base, messages, subagents, pendingPermissions, activity: results.size && !parent ? 'Thinking…' : session.activity });
    }

    case 'result': {
      messages = messages.map((m) => (m.role === 'tool' && m.status === 'running' ? { ...m, status: event.is_error ? 'error' : 'ok' } : m));
      const subagents = subs.map((s) => (s.status === 'running' && !s.background ? { ...s, status: event.is_error ? ('stopped' as const) : ('done' as const), endedAt: at, activity: undefined } : s));
      const s: ClaudeSession = {
        ...base,
        messages,
        subagents,
        usage: resultUsage(session.usage, event, session.model),
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

    case 'control_response': {
      // answers to our own requests: `initialize` (what the CLI offers), `set_model`, `set_permission_mode`
      const r = event.response;
      if (r.subtype !== 'success' || !r.response || typeof r.response !== 'object') return base;
      const p = r.response as Record<string, unknown>;
      const cat = catalogOf(p);
      return {
        ...base,
        ...(cat ? { commands: cat.commands, models: cat.models, ...(cat.cliVersion ? { cliVersion: cat.cliVersion } : {}) } : {}),
        ...(str(p['model']) ? { model: str(p['model']) } : {}),
        ...(str(p['mode']) ? { permissionMode: str(p['mode']) } : {}),
      };
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
  effort?: ClaudeEffort;
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

/** `--effort` levels (Claude Code 2.1.325) */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ClaudeEffort = (typeof EFFORT_LEVELS)[number];
/** `--permission-mode` choices (Claude Code 2.1.325) */
export const PERMISSION_MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'] as const;
/** model aliases offered while the CLI's own list (`initialize` → models) is not known */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

/** `claude:configure`: what to change in a session; `null` = back to the CLI default. */
export interface ClaudeConfigureRequest {
  model?: string | null;
  effort?: ClaudeEffort | null;
  permissionMode?: NonNullable<ClaudeStartRequest['permissionMode']>;
}

/**
 * Per changed setting: `live` = sent to the running process as a control request; `restart` = the
 * process cannot take it, the next message restarts it with `--resume`; `next` = no process
 * attached, it applies when the session resumes.
 */
export type ClaudeConfigureResult = Partial<Record<keyof ClaudeConfigureRequest, 'live' | 'restart' | 'next'>>;
