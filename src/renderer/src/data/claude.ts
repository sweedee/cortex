/**
 * Claude Code sessions (`native.claude.*`). Live updates arrive as `claude:state` / `claude:event`;
 * `sync/live.ts` keeps these caches fresh (state → invalidates the session, events → appended to
 * the transcript), so the hooks do not poll.
 */
import { useQuery } from '@tanstack/react-query';
import type { ClaudeAnswers, ClaudeConfigureRequest, ClaudePermissionDecision, ClaudeStartRequest } from '../../../shared/integrations/claude';
import { native } from '../native';
import { invalidate, ready } from './ops';
import { qk } from './queryKeys';

export function useClaudeSessions() {
  return useQuery({ queryKey: qk.claude.list(), queryFn: () => native.claude.list(), enabled: ready() });
}

/** One session with its folded messages (user / assistant / tool rows), status, usage. */
export function useClaudeSession(localId: string | undefined) {
  return useQuery({ queryKey: qk.claude.session(localId ?? ''), queryFn: () => native.claude.session(localId!), enabled: ready(localId), staleTime: 5_000 });
}

/** Raw stream-json events (replay with `replayTranscript` for a custom view). */
export function useClaudeTranscript(localId: string | undefined) {
  return useQuery({ queryKey: qk.claude.transcript(localId ?? ''), queryFn: () => native.claude.transcript(localId!), enabled: ready(localId), staleTime: Infinity });
}

/** Slash commands, skills and models the CLI offers (fetched once; a probe answers before the first session). */
export function useClaudeCatalog() {
  return useQuery({ queryKey: qk.claude.catalog(), queryFn: () => native.claude.catalog(), enabled: ready(), staleTime: Infinity, retry: false });
}

const touched = (localId: string) => invalidate(qk.claude.session(localId), qk.claude.list());

/** Writes. Status changes come back through `claude:state` (see `sync/live.ts`). */
export const claudeOps = {
  async start(req: ClaudeStartRequest) {
    const s = await native.claude.start(req);
    await invalidate(qk.claude.list());
    return s;
  },
  async send(localId: string, text: string) {
    const s = await native.claude.send(localId, text);
    await touched(localId);
    return s;
  },
  answer: (localId: string, toolUseId: string, answers: ClaudeAnswers) => native.claude.answer(localId, toolUseId, answers),
  permission: (localId: string, requestId: string, decision: ClaudePermissionDecision) => native.claude.permission(localId, requestId, decision),
  interrupt: (localId: string) => native.claude.interrupt(localId),
  /** model / effort / permission mode of a session: live when the process can take it (see the result) */
  async configure(localId: string, c: ClaudeConfigureRequest) {
    const r = await native.claude.configure(localId, c);
    await touched(localId);
    return r;
  },
  stop: (localId: string) => native.claude.stop(localId),
  async remove(localId: string) {
    const r = await native.claude.remove(localId);
    await touched(localId);
    return r;
  },
};
