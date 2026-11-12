/**
 * Mock Claude: plays scripted transcripts and canned replies, but speaks the same
 * stream-json event protocol as `claude -p --output-format stream-json`.
 */
import {
  agentScript,
  cannedReply,
  CHOICE_TRIGGER,
  decisionsMd,
  FOCUS_Q,
  FOCUS_QUESTIONS,
  focusReply,
  planFor,
  type Answers,
} from '../../mock/seed/sessions';
import type { AskQuestion, SessionMessage, WorkItem } from '../../model/types';
import { CLAUDE_DEFAULTS, GLOBAL_SESSION_ID } from '../config';
import type { ClaudeAnswers, ClaudeContentBlock, ClaudeEvent, ClaudeService, ClaudeStartOptions, ClaudeUsage } from '../types';
import { askResultContent, toClaudeEvents } from './serialize';
import { startBuild } from './tools';
import { delay, findWorktree, workItemById, world } from './world';

type Emit = ClaudeEvent extends infer E ? (E extends { session_id: string } ? Omit<E, 'session_id' | 'timestamp'> : never) : never;

const listeners = new Set<(event: ClaudeEvent) => void>();
/** bumping a session's generation cancels whatever it was doing */
const generation = new Map<string, number>();
const context = new Map<string, WorkItem | null>();
const models = new Map<string, string>();
let seq = 0;

// ---- usage figures ---------------------------------------------------------------
// Plausible, monotonically growing numbers: the context grows with every API call, the
// price per token depends on the model. Real Claude reports these itself.

/** invented $ per million tokens (input, output) — only the ordering matters */
const PRICE: Record<string, [number, number]> = {
  'claude-fable-5-2': [15, 75],
  'claude-opus-5-5': [5, 25],
  'claude-sonnet-5-5': [3, 15],
  'claude-haiku-5-5': [1, 5],
};
const GROWTH = [900, 2400, 1300, 5200, 1800, 3100]; // tokens a tool result / reply adds to the context
const BASE_CONTEXT = 11_800; // system prompt, tool definitions, CLAUDE.md

interface Meter {
  model: string;
  context: number;
  calls: number;
  turnStart: number;
  /** time spent waiting for the user, not counted as the turn's duration */
  paused: number;
  turnCalls: number;
  turnCost: number;
  turnUsage: ClaudeUsage;
}

const zeroUsage = (): ClaudeUsage => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const newMeter = (model: string): Meter => ({ model, context: 0, calls: 0, turnStart: Date.now(), paused: 0, turnCalls: 0, turnCost: 0, turnUsage: zeroUsage() });
const meters = new Map<string, Meter>();

function meterOf(sessionId: string): Meter {
  let m = meters.get(sessionId);
  if (!m) meters.set(sessionId, (m = newMeter(models.get(sessionId) ?? CLAUDE_DEFAULTS.model)));
  return m;
}

/** Adds the usage / cost fields a real CLI would have put on this event. */
function stamp(m: Meter, event: ClaudeEvent) {
  if (event.type === 'assistant' && !event.message.usage) {
    const blocks = event.message.content;
    const chars = blocks.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0);
    const read = m.context;
    const write = m.calls === 0 ? BASE_CONTEXT : GROWTH[m.calls % GROWTH.length];
    const usage: ClaudeUsage = {
      input_tokens: 3 + (m.calls % 4),
      output_tokens: chars > 0 ? Math.max(60, Math.round(chars / 3.5)) : 90 + (m.calls % 4) * 30,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: write,
    };
    const [pin, pout] = PRICE[m.model] ?? PRICE[CLAUDE_DEFAULTS.model];
    m.turnCost += (usage.input_tokens * pin + write * pin * 1.25 + read * pin * 0.1 + usage.output_tokens * pout) / 1e6;
    for (const k of Object.keys(usage) as (keyof ClaudeUsage)[]) m.turnUsage[k] = (m.turnUsage[k] ?? 0) + (usage[k] ?? 0);
    m.context = usage.input_tokens + read + write;
    m.calls++;
    m.turnCalls++;
    event.message.id = `msg_${(++seq).toString(36)}`;
    event.message.usage = usage;
  }
  if (event.type === 'result' && event.subtype !== 'interrupted' && event.total_cost_usd === undefined) {
    event.total_cost_usd = Math.round(m.turnCost * 10_000) / 10_000;
    event.duration_ms = event.duration_ms ?? Date.now() - m.turnStart - m.paused;
    event.num_turns = m.turnCalls;
    event.usage = { ...m.turnUsage };
  }
}

function emit(sessionId: string, event: Emit) {
  const full = { ...event, session_id: sessionId, timestamp: new Date().toISOString() } as ClaudeEvent;
  stamp(meterOf(sessionId), full);
  listeners.forEach((l) => l(full));
}

// ---- turns -----------------------------------------------------------------------

/** an open AskUserQuestion: resolved by `answerQuestion`, or with null by an interrupt / a new turn */
const pending = new Map<string, { toolUseId: string; resolve: (answers: ClaudeAnswers | null) => void }>();

/** Starts a turn (= one `claude -p` invocation): cancels the previous one and announces the model. */
function begin(sessionId: string, model?: string): () => boolean {
  const mine = (generation.get(sessionId) ?? 0) + 1;
  generation.set(sessionId, mine);
  pending.get(sessionId)?.resolve(null);
  pending.delete(sessionId);
  if (model) models.set(sessionId, model);
  const m = meterOf(sessionId);
  m.model = models.get(sessionId) ?? m.model;
  Object.assign(m, { turnStart: Date.now(), paused: 0, turnCalls: 0, turnCost: 0, turnUsage: zeroUsage() });
  emit(sessionId, { type: 'system', subtype: 'init', model: m.model });
  return () => generation.get(sessionId) === mine;
}

/**
 * Claude calls AskUserQuestion and waits. Resolves with the answers, or null if the turn was
 * cancelled meanwhile (interrupt) — callers then just return.
 */
async function askUser(sessionId: string, alive: () => boolean, questions: AskQuestion[], lead?: string): Promise<Answers | null> {
  const id = `toolu_${Date.now().toString(36)}${++seq}`;
  const content: ClaudeContentBlock[] = [];
  if (lead) content.push({ type: 'text', text: lead });
  content.push({ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } });
  emit(sessionId, { type: 'assistant', message: { content } });
  const asked = Date.now();
  const answers = await new Promise<ClaudeAnswers | null>((resolve) => pending.set(sessionId, { toolUseId: id, resolve }));
  meterOf(sessionId).paused += Date.now() - asked;
  if (!answers || !alive()) return null;
  emit(sessionId, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: askResultContent(answers) }] } });
  return Object.fromEntries(Object.entries(answers).map(([q, a]) => [q, Array.isArray(a) ? a.join(', ') : a]));
}

/** Streams a chat answer word by word, then the complete message, then the end-of-turn result. */
async function reply(sessionId: string, text: string, model?: string) {
  const alive = begin(sessionId, model);
  const work = context.get(sessionId) ?? null;
  let answer: string;
  if (!work && sessionId === GLOBAL_SESSION_ID && CHOICE_TRIGGER.test(text)) {
    await delay(700);
    if (!alive()) return;
    const answers = await askUser(sessionId, alive, FOCUS_QUESTIONS, 'Happy to help you pick. One question first, so I point you the right way.');
    if (!answers) return;
    answer = focusReply(answers[FOCUS_Q] ?? '');
    await delay(400);
  } else {
    answer = cannedReply(text, work);
    await delay(800);
  }
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
  const alive = begin(sessionId, options.model);
  // step 0 of the script is the user's prompt, which the app shows itself
  const steps = agentScript(options.kind, work).slice(1);
  const answers: Answers = {};
  const planText = () => planFor(work) + decisionsMd(answers);
  let finalText = '';
  for (const [i, step] of steps.entries()) {
    if (step.when && !step.when(answers)) continue;
    await new Promise((r) => setTimeout(r, 800));
    if (!alive()) return;
    if (step.ask) {
      const given = await askUser(sessionId, alive, step.ask);
      if (!given) return;
      Object.assign(answers, given);
      continue;
    }
    let draft = step.message;
    // the plan's last message is the plan itself, now with the user's decisions
    if (options.kind === 'plan' && i === steps.length - 1 && draft.role === 'assistant') draft = { ...draft, text: planText() };
    const message = { ...draft, id: `toolu_${Date.now().toString(36)}${++seq}`, at: '' } as SessionMessage;
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
  emit(sessionId, { type: 'result', subtype: 'success', is_error: false, result: options.kind === 'plan' ? planText() : finalText });
}

export const claude: ClaudeService = {
  async start(options) {
    await delay();
    const work = workItemById(options.workId) ?? null;
    context.set(options.sessionId, work);
    if (options.kind === 'chat' || !work) void reply(options.sessionId, options.prompt, options.model);
    else void runAgent(options, work);
  },

  async send(sessionId, text, options) {
    await delay();
    const stored = world.sessions.find((s) => s.session.id === sessionId);
    if (!context.has(sessionId)) context.set(sessionId, workItemById(stored?.session.workId ?? null) ?? null);
    void reply(sessionId, text, options?.model ?? (stored && !models.has(sessionId) ? stored.session.model : undefined));
  },

  async answerQuestion(sessionId, toolUseId, answers) {
    await delay(60);
    const open = pending.get(sessionId);
    if (!open || open.toolUseId !== toolUseId) return;
    pending.delete(sessionId);
    open.resolve(answers);
  },

  async interrupt(sessionId) {
    await delay(60);
    generation.set(sessionId, (generation.get(sessionId) ?? 0) + 1);
    pending.get(sessionId)?.resolve(null);
    pending.delete(sessionId);
    emit(sessionId, { type: 'result', subtype: 'interrupted', is_error: false });
  },

  async getTranscript(sessionId) {
    await delay();
    const stored = world.sessions.find((s) => s.session.id === sessionId);
    if (!stored) return { events: [], running: false };
    const { session, running } = stored;
    const base = { session_id: sessionId, timestamp: session.startedAt };
    // replay the usage figures a real run would have produced; later turns continue from them
    models.set(sessionId, session.model);
    const meter = newMeter(session.model);
    meters.set(sessionId, meter);
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
        duration_ms: Date.parse(last.at) - Date.parse(session.startedAt),
      });
    }
    events.forEach((e) => stamp(meter, e));
    return { events, running };
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
