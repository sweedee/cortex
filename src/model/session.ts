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
