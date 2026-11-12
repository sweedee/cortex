import type { AgentSession, SessionMessage } from './types';

export type ToolMessage = Extract<SessionMessage, { role: 'tool' }>;

export const ASK_TOOL = 'AskUserQuestion';

/** (plain boolean, not a type guard: a guard would also narrow ordinary tool calls out of the else branch) */
export const isQuestion = (m: SessionMessage): boolean => m.role === 'tool' && m.tool === ASK_TOOL && !!m.questions;

/** The AskUserQuestion Claude is waiting on, if any. */
export function openQuestion(messages: SessionMessage[]): ToolMessage | undefined {
  const last = messages.findLast((m): m is ToolMessage => m.role === 'tool' && isQuestion(m));
  return last?.status === 'running' ? last : undefined;
}

export const hasOpenQuestion = (s: AgentSession) => !!openQuestion(s.messages);

/** Activity text of a turn that ended with a question (the heuristic in services/mappers/claude.ts). */
export const NEEDS_INPUT_ACTIVITY = 'Needs your input';

/** Claude is parked until I answer: an open question card, or a turn that ended with a question. */
export const needsInput = (s: AgentSession) => hasOpenQuestion(s) || (s.status === 'waiting' && s.activity === NEEDS_INPUT_ACTIVITY);

const RANK = { running: 0, waiting: 1, failed: 2, done: 3 } as const;

/** The session to show first: running, then waiting for me, then failed, then the rest; ties keep the given order (newest first). */
export function mostRelevantSession(sessions: AgentSession[]): AgentSession | undefined {
  return [...sessions].sort((a, b) => {
    const ra = RANK[a.status] - (a.status === 'waiting' && !a.activity ? -2 : 0);
    const rb = RANK[b.status] - (b.status === 'waiting' && !b.activity ? -2 : 0);
    return ra - rb;
  })[0];
}
