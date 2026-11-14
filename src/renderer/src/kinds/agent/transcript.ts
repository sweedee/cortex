/**
 * The harness view of a Claude Code session: raw stream-json events (`useClaudeTranscript`) →
 * display rows. Messages and tool status come from the shared reducer (`applyClaudeEvent`, the same
 * one main uses); on top of that this keeps what the reducer drops: thinking blocks and tool inputs.
 * Pure, tested in `transcript.test.ts`.
 */
import { applyClaudeEvent, ASK_TOOL, newSession, type AskQuestion, type ClaudeEvent } from '../../../../shared/integrations/claude';

export type ToolStatus = 'running' | 'ok' | 'error';

export type Row =
  | { kind: 'user'; id: string; at: string; text: string }
  | { kind: 'assistant'; id: string; at: string; text: string }
  | { kind: 'thinking'; id: string; at: string; text: string }
  | { kind: 'tool'; id: string; at: string; tool: string; summary: string; status: ToolStatus; input?: Record<string, unknown>; result?: string }
  | { kind: 'question'; id: string; at: string; status: ToolStatus; questions: AskQuestion[]; answers?: Record<string, string>; error?: string };

/** Consecutive tool calls are drawn as one box. */
export type Block = { kind: 'row'; row: Row } | { kind: 'tools'; id: string; rows: Extract<Row, { kind: 'tool' }>[] };

export function buildRows(events: ClaudeEvent[], localId = 'session'): Row[] {
  let s = newSession({ localId, cwd: '', title: '' });
  const inputs = new Map<string, Record<string, unknown>>();
  // thinking blocks, keyed by the message index they come before
  const thinking: { before: number; row: Row }[] = [];
  for (const e of events) {
    if (e.type === 'assistant' && !e.parent_tool_use_id) {
      for (const b of e.message.content ?? []) {
        if (b.type === 'thinking' && b.thinking?.trim()) thinking.push({ before: s.messages.length, row: { kind: 'thinking', id: `${localId}-t${thinking.length}`, at: e.timestamp ?? '', text: b.thinking } });
        else if (b.type === 'tool_use') inputs.set(b.id, b.input ?? {});
      }
    }
    s = applyClaudeEvent(s, e);
  }
  const out: Row[] = [];
  let t = 0;
  s.messages.forEach((m, i) => {
    while (t < thinking.length && thinking[t].before <= i) out.push(thinking[t++].row);
    if (m.role !== 'tool') {
      if (m.text.trim()) out.push({ kind: m.role, id: m.id, at: m.at, text: m.text });
    } else if (m.tool === ASK_TOOL) {
      out.push({ kind: 'question', id: m.id, at: m.at, status: m.status, questions: m.questions ?? [], answers: m.answers, error: m.status === 'error' ? m.detail : undefined });
    } else {
      out.push({ kind: 'tool', id: m.id, at: m.at, tool: m.tool, summary: m.summary, status: m.status, input: inputs.get(m.id), result: m.detail });
    }
  });
  while (t < thinking.length) out.push(thinking[t++].row);
  return out;
}

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

// ---- status line numbers ---------------------------------------------------------------------

export const usd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);

/** 84_000 → "84k", 1_250 → "1.3k" */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** context bar tone: warning from 80 %, critical from 95 % */
export const contextTone = (pct: number) => (pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : 'normal');
