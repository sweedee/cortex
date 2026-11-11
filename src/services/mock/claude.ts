/**
 * Mock Claude: plays scripted transcripts and canned replies, but speaks the same
 * stream-json event protocol as `claude -p --output-format stream-json`.
 */
import { agentScript, cannedReply, MODEL, planFor } from '../../mock/seed/sessions';
import type { SessionMessage, WorkItem } from '../../model/types';
import type { ClaudeEvent, ClaudeService, ClaudeStartOptions } from '../types';
import { toClaudeEvents } from './serialize';
import { startBuild } from './tools';
import { delay, findWorktree, workItemById, world } from './world';

type Emit = ClaudeEvent extends infer E ? (E extends { session_id: string } ? Omit<E, 'session_id' | 'timestamp'> : never) : never;

const listeners = new Set<(event: ClaudeEvent) => void>();
/** bumping a session's generation cancels whatever it was doing */
const generation = new Map<string, number>();
const context = new Map<string, WorkItem | null>();
const started = new Set<string>();
let seq = 0;

function emit(sessionId: string, event: Emit) {
  const full = { ...event, session_id: sessionId, timestamp: new Date().toISOString() } as ClaudeEvent;
  listeners.forEach((l) => l(full));
}

function begin(sessionId: string): () => boolean {
  const mine = (generation.get(sessionId) ?? 0) + 1;
  generation.set(sessionId, mine);
  if (!started.has(sessionId)) {
    started.add(sessionId);
    emit(sessionId, { type: 'system', subtype: 'init', model: MODEL });
  }
  return () => generation.get(sessionId) === mine;
}

/** Streams a chat answer word by word, then the complete message, then the end-of-turn result. */
async function reply(sessionId: string, text: string) {
  const alive = begin(sessionId);
  const answer = cannedReply(text, context.get(sessionId) ?? null);
  await delay(800);
  const words = answer.split(/(?<=\s)/);
  for (let i = 0; i < words.length && alive(); i += 3) {
    emit(sessionId, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: words.slice(i, i + 3).join('') } } });
    await new Promise((r) => setTimeout(r, 45));
  }
  if (!alive()) return;
  emit(sessionId, { type: 'assistant', message: { content: [{ type: 'text', text: answer }] } });
  emit(sessionId, { type: 'result', subtype: 'success', is_error: false, result: answer });
}

/** What an agent leaves behind in the world once it is done. */
function sideEffects(options: ClaudeStartOptions, work: WorkItem) {
  const wt = findWorktree(work.worktree?.path);
  if (options.kind === 'implement' && wt) {
    wt.ahead += 3;
    wt.dirtyFiles = 0;
  }
  if (options.kind === 'fix-ci' && wt) {
    wt.ahead += 1;
    startBuild(work.repo, wt.branch); // the fix was pushed, CI picks it up
  }
}

/** Plays the scripted transcript of an agent, one step every second or so. */
async function runAgent(options: ClaudeStartOptions, work: WorkItem) {
  const { sessionId } = options;
  const alive = begin(sessionId);
  // step 0 of the script is the user's prompt, which the app shows itself
  const steps = agentScript(options.kind, work).slice(1);
  let finalText = '';
  for (const step of steps) {
    await new Promise((r) => setTimeout(r, 800));
    if (!alive()) return;
    const message = { ...step.message, id: `toolu_${Date.now().toString(36)}${++seq}`, at: '' } as SessionMessage;
    const [call, result] = toClaudeEvents(sessionId, message);
    emit(sessionId, call as Emit);
    if (message.role === 'assistant') finalText = message.text;
    if (result) {
      // tools take a moment, so the UI gets to show them as running
      await new Promise((r) => setTimeout(r, 300));
      if (!alive()) return;
      emit(sessionId, result as Emit);
    }
  }
  sideEffects(options, work);
  emit(sessionId, { type: 'result', subtype: 'success', is_error: false, result: options.kind === 'plan' ? planFor(work) : finalText });
}

export const claude: ClaudeService = {
  async start(options) {
    await delay();
    const work = workItemById(options.workId) ?? null;
    context.set(options.sessionId, work);
    if (options.kind === 'chat' || !work) void reply(options.sessionId, options.prompt);
    else void runAgent(options, work);
  },

  async send(sessionId, text) {
    await delay();
    if (!context.has(sessionId)) {
      const stored = world.sessions.find((s) => s.session.id === sessionId);
      context.set(sessionId, workItemById(stored?.session.workId ?? null) ?? null);
    }
    void reply(sessionId, text);
  },

  async interrupt(sessionId) {
    await delay(60);
    generation.set(sessionId, (generation.get(sessionId) ?? 0) + 1);
    emit(sessionId, { type: 'result', subtype: 'interrupted', is_error: false });
  },

  async getTranscript(sessionId) {
    await delay();
    const stored = world.sessions.find((s) => s.session.id === sessionId);
    if (!stored) return { events: [], running: false };
    const { session, running } = stored;
    if (session.messages.length > 0) started.add(sessionId);
    const base = { session_id: sessionId, timestamp: session.startedAt };
    const events: ClaudeEvent[] = [
      { ...base, type: 'system', subtype: 'init', model: session.model },
      ...session.messages.flatMap((m) => toClaudeEvents(sessionId, m, m.at)),
    ];
    if (!running && session.messages.length > 0) {
      const work = workItemById(session.workId);
      const last = session.messages[session.messages.length - 1];
      events.push({
        ...base,
        timestamp: last.at,
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: session.kind === 'plan' && work ? planFor(work) : last.role === 'assistant' ? last.text : undefined,
      });
    }
    return { events, running };
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
