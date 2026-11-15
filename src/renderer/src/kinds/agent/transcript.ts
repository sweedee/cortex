/**
 * The harness view of a Claude Code session: raw stream-json events (`useClaudeTranscript`) →
 * display rows. Messages and tool status come from the shared reducer (`applyClaudeEvent`, the same
 * one main uses); on top of that this keeps what the reducer drops: thinking blocks and tool inputs.
 * A subagent's messages (`parent`) are nested under its Task / Agent call as a `subagent` row.
 * `transcriptBuilder` does the same fold incrementally (only new events) and keeps unchanged rows by
 * identity, so the memoized rows in the sidebar skip re-rendering. Pure, tested in `agent.test.ts`.
 */
import {
  applyClaudeEvent,
  ASK_TOOL,
  isSubagentTool,
  newSession,
  type AskQuestion,
  type ClaudeEvent,
  type ClaudeSession,
  type SessionMessage,
  type SubagentInfo,
} from '../../../../shared/integrations/claude';

export { contextTone, tokens, usd } from './usage';

export type ToolStatus = 'running' | 'ok' | 'error';

export type ToolRowData = { kind: 'tool'; id: string; at: string; tool: string; summary: string; status: ToolStatus; input?: Record<string, unknown>; result?: string };

export type Row =
  | { kind: 'user'; id: string; at: string; text: string }
  | { kind: 'assistant'; id: string; at: string; text: string }
  | { kind: 'thinking'; id: string; at: string; text: string }
  | { kind: 'note'; id: string; at: string; text: string }
  | ToolRowData
  | { kind: 'question'; id: string; at: string; status: ToolStatus; questions: AskQuestion[]; answers?: Record<string, string>; error?: string }
  /** a Task / Agent call: the subagent, its prompt and result, and what it did (tools and text, nested subagents) */
  | { kind: 'subagent'; id: string; at: string; tool: string; status: ToolStatus; sub: SubagentInfo; prompt?: string; result?: string; children: Row[] };

/** Consecutive tool calls are drawn as one box. */
export type Block = { kind: 'row'; row: Row } | { kind: 'tools'; id: string; rows: ToolRowData[] };

export interface Transcript {
  rows: Row[];
  subagents: SubagentInfo[];
}

/** Rows plus the subagent list (from the same fold). */
export function buildTranscript(events: readonly ClaudeEvent[], localId = 'session'): Transcript {
  return transcriptBuilder(localId).update(events);
}

export interface TranscriptBuilder {
  readonly localId: string;
  /**
   * The transcript of `events`. When `events` extends the list of the previous call (an append:
   * same first and last consumed event), only the new events are folded; otherwise it starts over.
   * Rows whose message, tool input, subagent and children did not change keep their identity, and
   * the result itself is the previous one when nothing changed (so memoized views skip work).
   */
  update(events: readonly ClaudeEvent[]): Transcript;
}

type Cached = { input?: Record<string, unknown>; sub?: SubagentInfo; children?: Row[]; row: Row | null };

const sameRows = (a: readonly Row[] | undefined, b: readonly Row[] | undefined) => a === b || (!!a && !!b && a.length === b.length && a.every((r, i) => r === b[i]));

/** An incremental `buildTranscript`: keeps the fold and consumes only events it has not seen. */
export function transcriptBuilder(localId = 'session'): TranscriptBuilder {
  let s: ClaudeSession;
  let inputs: Map<string, Record<string, unknown>>;
  // main-thread thinking blocks, keyed by the message index they come before
  let thinking: { before: number; row: Row }[];
  // rows by message (the reducer keeps unchanged messages by identity)
  let cache: WeakMap<SessionMessage, Cached>;
  let first: ClaudeEvent | undefined;
  let last: ClaudeEvent | undefined;
  let count: number;
  let out: Transcript;

  const reset = () => {
    s = newSession({ localId, cwd: '', title: '' });
    inputs = new Map();
    thinking = [];
    cache = new WeakMap();
    first = last = undefined;
    count = 0;
    out = { rows: [], subagents: s.subagents };
  };

  const consume = (e: ClaudeEvent) => {
    if (e.type === 'assistant') {
      for (const b of e.message.content ?? []) {
        if (b.type === 'thinking' && b.thinking?.trim() && !e.parent_tool_use_id)
          thinking.push({ before: s.messages.length, row: { kind: 'thinking', id: `${localId}-t${thinking.length}`, at: e.timestamp ?? '', text: b.thinking } });
        else if (b.type === 'tool_use') inputs.set(b.id, b.input ?? {});
      }
    }
    s = applyClaudeEvent(s, e);
  };

  const build = (): Transcript => {
    const subs = new Map(s.subagents.map((x) => [x.toolUseId, x]));
    const byParent = new Map<string, SessionMessage[]>();
    for (const m of s.messages) {
      if (!m.parent) continue;
      const list = byParent.get(m.parent);
      if (list) list.push(m);
      else byParent.set(m.parent, [m]);
    }

    const toRow = (m: SessionMessage): Row | null => {
      const tool = m.role === 'tool' && m.tool !== ASK_TOOL;
      const input = tool ? inputs.get(m.id) : undefined;
      const sub = tool && isSubagentTool(m.tool) ? subs.get(m.id) : undefined;
      const children = sub ? (byParent.get(m.id) ?? []).map(toRow).filter((r): r is Row => !!r) : undefined;
      const hit = cache.get(m);
      if (hit && hit.input === input && hit.sub === sub && sameRows(hit.children, children)) return hit.row;
      const row = rowOf(m, input, sub, children);
      cache.set(m, { input, sub, children, row });
      return row;
    };

    const rows: Row[] = [];
    let t = 0;
    s.messages.forEach((m, i) => {
      for (let th = thinking[t]; th && th.before <= i; th = thinking[t]) {
        rows.push(th.row);
        t++;
      }
      if (m.parent) return; // drawn inside its subagent
      const r = toRow(m);
      if (r) rows.push(r);
    });
    for (const th of thinking.slice(t)) rows.push(th.row);
    if (sameRows(rows, out.rows) && s.subagents === out.subagents) return out;
    return { rows: sameRows(rows, out.rows) ? out.rows : rows, subagents: s.subagents };
  };

  reset();
  return {
    localId,
    update(events) {
      const appended = count === 0 || (events.length >= count && events[0] === first && events[count - 1] === last);
      if (!appended) reset();
      if (events.length === count) return out;
      for (const ev of events.slice(count)) consume(ev);
      first = events[0];
      last = events[events.length - 1];
      count = events.length;
      out = build();
      return out;
    },
  };
}

function rowOf(m: SessionMessage, input: Record<string, unknown> | undefined, sub: SubagentInfo | undefined, children: Row[] | undefined): Row | null {
  if (m.role === 'note') return { kind: 'note', id: m.id, at: m.at, text: m.text };
  if (m.role !== 'tool') return m.text.trim() ? { kind: m.role, id: m.id, at: m.at, text: m.text } : null;
  if (m.tool === ASK_TOOL) return { kind: 'question', id: m.id, at: m.at, status: m.status, questions: m.questions ?? [], answers: m.answers, error: m.status === 'error' ? m.detail : undefined };
  if (sub)
    return {
      kind: 'subagent',
      id: m.id,
      at: m.at,
      tool: m.tool,
      status: m.status,
      sub,
      prompt: typeof input?.['prompt'] === 'string' ? input['prompt'] : undefined,
      result: m.detail,
      children: children ?? [],
    };
  return { kind: 'tool', id: m.id, at: m.at, tool: m.tool, summary: m.summary, status: m.status, input, result: m.detail };
}

export const buildRows = (events: readonly ClaudeEvent[], localId = 'session'): Row[] => buildTranscript(events, localId).rows;

export function groupRows(rows: Row[]): Block[] {
  const out: Block[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (r.kind === 'tool' && last?.kind === 'tools') last.rows.push(r);
    else if (r.kind === 'tool') out.push({ kind: 'tools', id: r.id, rows: [r] });
    else out.push({ kind: 'row', row: r });
  }
  return out;
}
/** The tool's input, shown when a tool row is expanded (besides the summary line). Empty = nothing worth showing. */
export function inputText(tool: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  if ((tool === 'Edit' || tool === 'MultiEdit') && typeof input['old_string'] === 'string') {
    const minus = String(input['old_string'])
      .split('\n')
      .map((l) => `- ${l}`);
    const plus = String(input['new_string'] ?? '')
      .split('\n')
      .map((l) => `+ ${l}`);
    return [...minus, ...plus].join('\n');
  }
  if (tool === 'Write' && typeof input['content'] === 'string') return String(input['content']);
  const rest = Object.fromEntries(Object.entries(input).filter(([k]) => !['file_path', 'command', 'pattern', 'description'].includes(k)));
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
}

/** "Which approach?" + multiSelect picks + free text → the `answers` claude:answer takes. */
export interface Choice {
  picked: string[];
  other: boolean;
  text: string;
}
export const emptyChoice: Choice = { picked: [], other: false, text: '' };
export const isAnswered = (c: Choice) => c.picked.length > 0 || (c.other && c.text.trim() !== '');

export function toggleChoice(c: Choice, label: string, multi: boolean): Choice {
  if (multi) return { ...c, picked: c.picked.includes(label) ? c.picked.filter((l) => l !== label) : [...c.picked, label] };
  return { picked: [label], other: false, text: c.text };
}
export const toggleOther = (c: Choice, multi: boolean): Choice => (multi ? { ...c, other: !c.other } : { picked: [], other: true, text: c.text });

export function answersOf(questions: AskQuestion[] | { question: string; multiSelect?: boolean }[], choices: Choice[]): Record<string, string | string[]> {
  return Object.fromEntries(
    questions.map((q, i) => {
      const c = choices[i] ?? emptyChoice;
      const parts = [...c.picked, ...(c.other && c.text.trim() ? [c.text.trim()] : [])];
      return [q.question, q.multiSelect ? parts : (parts[0] ?? '')];
    }),
  );
}
