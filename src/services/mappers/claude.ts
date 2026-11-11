/**
 * Claude stream-json events → domain AgentSession.
 *
 * `applyClaudeEvent` is a pure reducer: feed it every event of a session in order
 * (stored transcript first, then live events) and it keeps the session's messages,
 * status and "what is it doing right now" line up to date.
 */
import type { AgentSession, SessionMessage } from '../../model/types';
import type { ClaudeContentBlock, ClaudeEvent } from '../types';

const DRAFT = '-draft';

const VERBS: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Bash: 'Running',
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
  const preferred = ['file_path', 'command', 'pattern', 'url', 'query', 'description', 'path'];
  for (const key of preferred) {
    if (typeof input[key] === 'string') return input[key];
  }
  const first = Object.values(input).find((v) => typeof v === 'string');
  return typeof first === 'string' ? first : '';
}

const activityOf = (tool: string, summary: string) => `${VERBS[tool] ?? tool} ${summary}`.trim();

const lastAssistantText = (messages: SessionMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') return m.text;
  }
  return '';
};

/** tool_result content is a string, or (for some tools) a list of text blocks. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: { text?: string }) => c.text ?? '').join('\n');
  return '';
}

export function applyClaudeEvent(session: AgentSession, event: ClaudeEvent): AgentSession {
  const at = event.timestamp ?? new Date().toISOString();
  let messages = session.messages;
  const nextId = () => `${session.id}-m${messages.length + 1}`;
  const last = messages[messages.length - 1];
  const draft = last?.role === 'assistant' && last.id.endsWith(DRAFT) ? last : undefined;

  switch (event.type) {
    case 'system':
      return { ...session, model: event.model, status: 'running' };

    case 'stream_event': {
      const text = event.event.delta.text;
      messages = draft
        ? [...messages.slice(0, -1), { ...draft, text: draft.text + text }]
        : [...messages, { id: nextId() + DRAFT, role: 'assistant', at, text }];
      return { ...session, messages, status: 'running', activity: 'Writing…' };
    }

    case 'assistant': {
      let activity = session.activity;
      let draftOpen = !!draft;
      for (const blockItem of event.message.content) {
        if (blockItem.type === 'text') {
          if (draftOpen) {
            // the complete message replaces what was streamed so far
            const d = messages[messages.length - 1];
            messages = [...messages.slice(0, -1), { ...d, id: d.id.slice(0, -DRAFT.length), text: blockItem.text } as SessionMessage];
            draftOpen = false;
          } else {
            messages = [...messages, { id: nextId(), role: 'assistant', at, text: blockItem.text }];
          }
        } else if (blockItem.type === 'tool_use') {
          const summary = toolSummary(blockItem.input);
          messages = [...messages, { id: blockItem.id, role: 'tool', at, tool: blockItem.name, summary, status: 'running' }];
          activity = activityOf(blockItem.name, summary);
        }
      }
      return { ...session, messages, status: 'running', activity };
    }

    case 'user': {
      const content = event.message.content;
      if (typeof content === 'string') {
        // only stored transcripts contain the user's prompts; live, the app adds them itself
        return { ...session, messages: [...messages, { id: nextId(), role: 'user', at, text: content }] };
      }
      const results = new Map<string, ClaudeContentBlock & { type: 'tool_result' }>();
      const texts: string[] = [];
      for (const b of content) {
        if (b.type === 'tool_result') results.set(b.tool_use_id, b);
        else if (b.type === 'text') texts.push(b.text);
      }
      messages = messages.map((m) => {
        const r = m.role === 'tool' ? results.get(m.id) : undefined;
        if (!r || m.role !== 'tool') return m;
        return { ...m, status: r.is_error ? 'error' : 'ok', detail: resultText(r.content) || undefined };
      });
      if (texts.length > 0) messages = [...messages, { id: nextId(), role: 'user', at, text: texts.join('\n') }];
      return { ...session, messages };
    }

    case 'result': {
      // nothing can still be running once the turn is over
      messages = messages.map((m) =>
        m.role === 'tool' && m.status === 'running' ? { ...m, status: event.subtype === 'interrupted' ? 'error' : 'ok' } : m,
      );
      if (event.subtype === 'interrupted') {
        return { ...session, messages, status: 'waiting', activity: 'Interrupted — waiting for input' };
      }
      if (event.is_error) return { ...session, messages, status: 'failed', activity: undefined };
      // Heuristic: a turn that ends with a question is Claude asking me something.
      // (trailing markdown emphasis is ignored: "**…or fix?**")
      const asksMe = lastAssistantText(messages).replace(/[\s*_`]+$/, '').endsWith('?');
      if (asksMe && session.workId) return { ...session, messages, status: 'waiting', activity: 'Needs your input' };
      return { ...session, messages, status: session.kind === 'chat' ? 'waiting' : 'done', activity: undefined };
    }
  }
}

/** Replays a stored transcript. `running` = a process is still attached to the session. */
export function replayTranscript(session: AgentSession, events: ClaudeEvent[], running: boolean): AgentSession {
  let s = events.reduce(applyClaudeEvent, session);
  if (running && s.status !== 'running') s = { ...s, status: 'running' };
  if (!running && s.status === 'running') s = { ...s, status: session.kind === 'chat' ? 'waiting' : 'done', activity: undefined };
  return s;
}

/** The plan a plan-agent produced = the final result text of its last successful turn. */
export function planFromEvents(events: ClaudeEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'result' && !e.is_error && e.result) return e.result;
  }
  return undefined;
}
