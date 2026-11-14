/**
 * Claude Code sessions: one long-lived `claude -p --input-format stream-json --output-format
 * stream-json --verbose --permission-prompt-tool stdio` process per session. User messages and
 * control messages go to stdin as JSON lines; every stdout line is an event, folded into the
 * session with the shared reducer and pushed as `claude:event` / `claude:state`.
 *
 * AskUserQuestion: with `--permission-prompt-tool stdio` the CLI asks the host before running a
 * tool by writing a `control_request` {subtype: 'can_use_tool', tool_name, input, tool_use_id}.
 * For AskUserQuestion we park that request; `answer()` replies with a `control_response`
 * `{behavior: 'allow', updatedInput: {...input, answers: {question: label}}}` — the same thing the
 * Agent SDK's `canUseTool` does — and the CLI writes the tool_result itself. When no such request
 * arrived (older CLI, prompts disabled), `answer()` falls back to sending the answers as the next
 * user message. Other tools' prompts become `pendingPermissions`, answered with `permission()`.
 *
 * Interrupt = `control_request {subtype: 'interrupt'}` (the turn ends, the process stays).
 * Metadata (local id, Claude session id, cwd, title, model) is kept in a small JSON file so a
 * session can be continued after an app restart: `send()` on a session without a process
 * respawns it with `--resume <session id>`.
 */
import { type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import spawn from 'cross-spawn';
import {
  answersAsText,
  applyClaudeEvent,
  ASK_TOOL,
  catalogOf,
  flattenAnswers,
  newSession,
  parseStreamLine,
  replayTranscript,
  toSummary,
  type ClaudeAnswers,
  type ClaudeCatalog,
  type ClaudeConfigureRequest,
  type ClaudeConfigureResult,
  type ClaudeEvent,
  type ClaudeEventMessage,
  type ClaudePermissionDecision,
  type ClaudeSession,
  type ClaudeSessionSummary,
  type ClaudeStartRequest,
} from '../../shared/integrations/claude';
import { atomicWrite } from '../lib/atomicWrite';
import { killTree, treeSpawnOptions } from '../lib/killTree';
import { LogTail } from '../lib/batcher';

export interface ClaudeManagerOptions {
  /** binary; tests pass `process.execPath` + a fake script in `prefixArgs` */
  bin: string;
  prefixArgs?: string[];
  /** session metadata file; omitted = nothing persisted */
  storeFile?: string;
  send(channel: 'claude:event', payload: ClaudeEventMessage): void;
  send(channel: 'claude:state', payload: ClaudeSessionSummary): void;
  env?: Record<string, string>;
  /** where Claude Code keeps transcripts (default ~/.claude/projects) */
  projectsDir?: string;
  defaultPermissionMode?: string;
}

interface Entry {
  session: ClaudeSession;
  req: ClaudeStartRequest;
  events: ClaudeEvent[];
  child?: ChildProcess;
  /** AskUserQuestion tool_use id → parked can_use_tool request */
  asks: Map<string, { requestId: string; input: Record<string, unknown> }>;
  /** our own control requests in flight (set_model …) → what they change, for error reporting */
  controls: Map<string, string>;
  stderr: LogTail;
  interrupting: boolean;
  stopping: boolean;
}

interface StoredSession {
  localId: string;
  sessionId?: string;
  cwd: string;
  title: string;
  model?: string;
  permissionMode?: string;
  effort?: string;
  modelSetting?: string;
  createdAt: string;
  updatedAt: string;
  lastText?: string;
  costUsd?: number;
  contextWindow?: number;
}

/** `--effort` levels the running process takes live (`apply_flag_settings {effortLevel}`); `max` is flag-only */
const LIVE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh']);

let seq = 0;

/** Claude Code's project folder name for a cwd: every non-alphanumeric char → `-`. */
export const projectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** Stored transcript `~/.claude/projects/<slug>/<sessionId>.jsonl` → events the reducer understands. */
export function readStoredTranscript(projectsDir: string, cwd: string, sessionId: string): ClaudeEvent[] {
  let file = join(projectsDir, projectSlug(cwd), `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    // the slug rules have changed between versions; look in every project folder
    try {
      const hit = readdirSync(projectsDir).find((d) => existsSync(join(projectsDir, d, `${sessionId}.jsonl`)));
      if (!hit) return [];
      file = join(projectsDir, hit, `${sessionId}.jsonl`);
    } catch {
      return [];
    }
  }
  const out: ClaudeEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const e = parseStreamLine(line) as (ClaudeEvent & { isMeta?: boolean; isSidechain?: boolean }) | null;
    if (!e || e.isMeta || e.isSidechain) continue;
    if (e.type === 'user' || e.type === 'assistant') out.push({ ...e, session_id: sessionId } as ClaudeEvent);
  }
  return out;
}

export class ClaudeSessions {
  private entries = new Map<string, Entry>();
  private opts: ClaudeManagerOptions;
  private saveChain: Promise<void> = Promise.resolve();
  /** what the CLI offers, from the latest `initialize` answer (any session, or a probe) */
  private latestCatalog?: ClaudeCatalog;
  private probing?: Promise<ClaudeCatalog>;
  /** context window per model id, learned from result events */
  private windows = new Map<string, number>();

  constructor(opts: ClaudeManagerOptions) {
    this.opts = opts;
    this.load();
  }

  // ---- persistence ------------------------------------------------------------------

  private load() {
    const file = this.opts.storeFile;
    if (!file || !existsSync(file)) return;
    try {
      const list = JSON.parse(readFileSync(file, 'utf8')) as StoredSession[];
      for (const s of list) {
        const session: ClaudeSession = {
          ...newSession({ localId: s.localId, cwd: s.cwd, title: s.title, sessionId: s.sessionId, model: s.model, permissionMode: s.permissionMode, effort: s.effort, at: s.createdAt }),
          status: 'done',
          running: false,
          updatedAt: s.updatedAt,
          lastText: s.lastText,
          ...(s.modelSetting ? { modelSetting: s.modelSetting } : {}),
        };
        session.usage = { ...session.usage, costUsd: s.costUsd ?? 0, contextWindow: s.contextWindow };
        if (s.model && s.contextWindow) this.windows.set(s.model, s.contextWindow);
        this.entries.set(s.localId, {
          session,
          req: { cwd: s.cwd, title: s.title, model: s.modelSetting ?? s.model, effort: s.effort as ClaudeStartRequest['effort'], permissionMode: s.permissionMode as ClaudeStartRequest['permissionMode'] },
          events: [],
          asks: new Map(),
          controls: new Map(),
          stderr: new LogTail(16 * 1024),
          interrupting: false,
          stopping: false,
        });
      }
    } catch {
      /* corrupt file: start empty, it is rewritten on the next change */
    }
  }

  private persist() {
    const file = this.opts.storeFile;
    if (!file) return;
    const list: StoredSession[] = [...this.entries.values()].map(({ session: s, req }) => ({
      localId: s.localId,
      sessionId: s.sessionId,
      cwd: s.cwd,
      title: s.title,
      model: s.model,
      permissionMode: req.permissionMode,
      effort: req.effort,
      modelSetting: req.model,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastText: s.lastText?.slice(0, 500),
      costUsd: s.usage.costUsd,
      contextWindow: s.usage.contextWindow,
    }));
    const text = JSON.stringify(list, null, 2);
    this.saveChain = this.saveChain.then(() => atomicWrite(file, text)).catch(() => {});
  }

  /** resolves when pending metadata writes are done (tests, quit) */
  flush(): Promise<void> {
    return this.saveChain;
  }

  // ---- process ------------------------------------------------------------------------

  private args(req: ClaudeStartRequest, sessionId: string, resume: boolean): string[] {
    const a = [...(this.opts.prefixArgs ?? []), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio'];
    if (resume) a.push('--resume', sessionId);
    else a.push('--session-id', sessionId);
    if (req.model) a.push('--model', req.model);
    if (req.effort) a.push('--effort', req.effort);
    const mode = req.permissionMode ?? this.opts.defaultPermissionMode;
    if (mode && mode !== 'default') a.push('--permission-mode', mode);
    for (const d of req.addDirs ?? []) a.push('--add-dir', d);
    if (req.appendSystemPrompt) a.push('--append-system-prompt', req.appendSystemPrompt);
    return a;
  }

  private spawn(e: Entry, resume: boolean) {
    const sessionId = e.session.sessionId ?? randomUUID();
    e.session = { ...e.session, sessionId, running: true, status: 'starting', error: undefined, restartPending: undefined, usage: { ...e.session.usage, processCostUsd: 0 } };
    e.controls = new Map();
    e.interrupting = false;
    e.stopping = false;
    e.stderr = new LogTail(16 * 1024);
    const child = spawn(this.opts.bin, this.args(e.req, sessionId, resume), {
      cwd: e.session.cwd,
      env: { ...process.env, ...this.opts.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...treeSpawnOptions,
    });
    e.child = child;

    let buf = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const ev = parseStreamLine(line);
        if (ev) this.onEvent(e, ev);
      }
    });
    child.stderr?.setEncoding('utf8').on('data', (c: string) => e.stderr.push(c));
    child.stdin?.on('error', () => {}); // EPIPE once it is gone

    let done = false;
    const finish = (code: number | null, error?: string) => {
      if (done) return;
      done = true;
      if (e.child !== child) return;
      e.child = undefined;
      const tail = buf.trim();
      if (tail) {
        const ev = parseStreamLine(tail);
        if (ev) this.onEvent(e, ev);
      }
      const failed = !e.stopping && (!!error || (code !== 0 && code !== null) || e.session.status === 'failed');
      const msg = error ?? (failed ? e.stderr.text().trim().split('\n').slice(-5).join('\n') || `claude exited with code ${code}` : undefined);
      e.asks.clear();
      e.session = {
        ...e.session,
        running: false,
        status: failed ? 'failed' : 'done',
        activity: undefined,
        pendingQuestion: undefined,
        pendingPermissions: [],
        error: failed ? (e.session.error ?? msg) : undefined,
        updatedAt: new Date().toISOString(),
      };
      this.emitState(e);
      this.persist();
    };
    child.on('error', (err) => finish(null, `Could not start ${this.opts.bin}: ${err.message}`));
    child.on('close', (code) => finish(code));

    this.write(e, { type: 'control_request', request_id: `init-${++seq}`, request: { subtype: 'initialize' } });
  }

  private write(e: Entry, msg: unknown): boolean {
    const stdin = e.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    stdin.write(JSON.stringify(msg) + '\n');
    return true;
  }

  private emitState(e: Entry) {
    this.opts.send('claude:state', toSummary(e.session));
  }

  private record(e: Entry, ev: ClaudeEvent) {
    const stamped = { ...ev, timestamp: ev.timestamp ?? new Date().toISOString() } as ClaudeEvent;
    e.events.push(stamped);
    this.opts.send('claude:event', { localId: e.session.localId, event: stamped });
    return stamped;
  }

  private onEvent(e: Entry, raw: ClaudeEvent) {
    const ev = this.record(e, raw);
    if (ev.type === 'control_request' && ev.request.subtype === 'can_use_tool') {
      const r = ev.request as { tool_name: string; input: Record<string, unknown>; tool_use_id?: string };
      if (r.tool_name === ASK_TOOL) {
        const toolUseId = r.tool_use_id ?? e.session.pendingQuestion?.toolUseId ?? `ask-${ev.request_id}`;
        e.asks.set(toolUseId, { requestId: ev.request_id, input: r.input ?? {} });
      }
    } else if (ev.type === 'control_request') {
      // we don't serve other host requests (hooks, MCP, elicitation): say so, so the CLI doesn't hang
      this.write(e, { type: 'control_response', response: { subtype: 'error', request_id: ev.request_id, error: `cortex does not handle ${ev.request.subtype}` } });
    }
    const prev = e.session;
    let s = applyClaudeEvent(e.session, ev);
    if (ev.type === 'control_response') {
      const what = e.controls.get(ev.response.request_id);
      e.controls.delete(ev.response.request_id);
      if (ev.response.subtype === 'error' && what) {
        // the CLI refused a live change: it applies with a restart instead
        s = { ...s, activity: `Could not change ${what} live: ${ev.response.error ?? 'refused'}; applies with the next message`, restartPending: [...new Set([...(s.restartPending ?? []), what])] };
      }
      if (ev.response.subtype === 'success') {
        const cat = catalogOf(ev.response.response);
        if (cat) this.latestCatalog = cat;
      }
    }
    if (ev.type === 'result') {
      e.asks.clear();
      if (e.interrupting) {
        s = { ...s, status: 'idle', error: undefined, activity: 'Interrupted' };
        e.interrupting = false;
      }
      if (s.model && s.usage.contextWindow) this.windows.set(s.model, s.usage.contextWindow);
    }
    // the window is only reported with a result: reuse what an earlier session of that model learned
    if (!s.usage.contextWindow && s.model && this.windows.has(s.model)) s = { ...s, usage: { ...s.usage, contextWindow: this.windows.get(s.model) } };
    if (s.status === 'running' && e.child === undefined) s = { ...s, status: 'done' };
    e.session = s;
    // our own acks: nothing visible changed
    if (ev.type === 'control_response' && prev.status === s.status && prev.model === s.model && prev.permissionMode === s.permissionMode && prev.activity === s.activity && prev.cliVersion === s.cliVersion) return;
    this.emitState(e);
    if (ev.type === 'result' || (ev.type === 'system' && 'subtype' in ev && ev.subtype === 'init')) this.persist();
  }

  private sendUser(e: Entry, text: string) {
    const sessionId = e.session.sessionId ?? '';
    this.write(e, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: sessionId });
    // the CLI doesn't echo our own message: record it for the transcript
    const ev = this.record(e, { type: 'user', session_id: sessionId, message: { role: 'user', content: text } });
    e.session = { ...applyClaudeEvent(e.session, ev), status: e.session.status === 'starting' ? 'starting' : 'running', activity: 'Thinking…' };
    this.emitState(e);
  }

  private control(e: Entry, what: string, request: Record<string, unknown>): boolean {
    const id = `cfg-${++seq}`;
    if (!this.write(e, { type: 'control_request', request_id: id, request })) return false;
    e.controls.set(id, what);
    return true;
  }

  private get(localId: string): Entry {
    const e = this.entries.get(localId);
    if (!e) throw new Error(`Unknown Claude session "${localId}"`);
    return e;
  }

  // ---- API ------------------------------------------------------------------------------

  start(req: ClaudeStartRequest): ClaudeSessionSummary {
    const localId = req.localId ?? `cs-${Date.now().toString(36)}-${(++seq).toString(36)}`;
    const existing = this.entries.get(localId);
    if (existing?.child) throw new Error(`Claude session "${localId}" is already running`);
    const title = req.title ?? (req.prompt ? req.prompt.split('\n')[0].slice(0, 80) : 'Claude session');
    const session = newSession({ localId, cwd: req.cwd, title, sessionId: req.resume ?? existing?.session.sessionId, model: req.model, effort: req.effort, permissionMode: req.permissionMode ?? this.opts.defaultPermissionMode });
    const e: Entry = existing ?? { session, req, events: [], asks: new Map(), controls: new Map(), stderr: new LogTail(16 * 1024), interrupting: false, stopping: false };
    if (existing) {
      e.req = { ...existing.req, ...req };
      e.session = { ...existing.session, title: req.title ?? existing.session.title, model: req.model ?? existing.session.model, effort: req.effort ?? existing.session.effort, sessionId: req.resume ?? existing.session.sessionId };
    }
    e.session = { ...e.session, modelSetting: e.req.model };
    this.entries.set(localId, e);
    this.spawn(e, !!e.session.sessionId && (!!req.resume || !!existing));
    if (req.prompt) this.sendUser(e, req.prompt);
    else this.emitState(e);
    this.persist();
    return toSummary(e.session);
  }

  /**
   * Next user message. Respawns with `--resume` when no process is attached, or when a setting
   * changed that the running process cannot take live (`restartPending`) and it is between turns.
   */
  async send(localId: string, text: string): Promise<ClaudeSessionSummary> {
    const e = this.get(localId);
    if (e.child && e.session.restartPending?.length && e.session.status === 'idle') await this.stop(localId);
    if (!e.child) {
      if (!e.session.sessionId) throw new Error(`Claude session "${localId}" has no session id to resume`);
      this.spawn(e, true);
    }
    // a typed message while a question is open: deny the question so Claude reads the message instead
    for (const [toolUseId, ask] of e.asks) {
      this.write(e, { type: 'control_response', response: { subtype: 'success', request_id: ask.requestId, response: { behavior: 'deny', message: 'The user replied in the chat instead of answering.' } } });
      e.asks.delete(toolUseId);
    }
    this.sendUser(e, text);
    return toSummary(e.session);
  }

  /**
   * Change model / effort / permission mode of a session. A running process gets them live over
   * the control protocol (`set_model`, `set_permission_mode`, `apply_flag_settings {effortLevel}`);
   * what it cannot take (effort `max`, back to the default effort) waits for a restart with the
   * next message. Either way the next spawn passes them as flags.
   */
  configure(localId: string, c: ClaudeConfigureRequest): ClaudeConfigureResult {
    const e = this.get(localId);
    const out: ClaudeConfigureResult = {};
    const pending = new Set(e.session.restartPending ?? []);
    const live = !!e.child && !e.stopping;
    if (c.model !== undefined) {
      const model = c.model && c.model !== 'default' ? c.model : undefined;
      e.req = { ...e.req, model };
      e.session = { ...e.session, model: model ?? e.session.model, modelSetting: model };
      out.model = live ? (this.control(e, 'model', { subtype: 'set_model', model: model ?? 'default' }) ? 'live' : 'restart') : 'next';
    }
    if (c.permissionMode !== undefined) {
      e.req = { ...e.req, permissionMode: c.permissionMode };
      e.session = { ...e.session, permissionMode: c.permissionMode };
      out.permissionMode = live ? (this.control(e, 'permission mode', { subtype: 'set_permission_mode', mode: c.permissionMode }) ? 'live' : 'restart') : 'next';
    }
    if (c.effort !== undefined) {
      const effort = c.effort ?? undefined;
      e.req = { ...e.req, effort };
      e.session = { ...e.session, effort };
      if (!live) out.effort = 'next';
      else if (effort && LIVE_EFFORT.has(effort) && this.control(e, 'effort', { subtype: 'apply_flag_settings', settings: { effortLevel: effort } })) {
        out.effort = 'live';
        pending.delete('effort');
      } else {
        out.effort = 'restart';
        pending.add('effort');
      }
    }
    for (const [k, v] of Object.entries(out)) if (v === 'restart' && k !== 'effort') pending.add(k === 'permissionMode' ? 'permission mode' : k);
    e.session = { ...e.session, restartPending: live && pending.size ? [...pending] : undefined, updatedAt: new Date().toISOString() };
    this.emitState(e);
    this.persist();
    return out;
  }

  /**
   * What the CLI offers (slash commands, skills, models). From the latest `initialize` answer of
   * any session; before the first session a short probe process answers `initialize` (no API call,
   * no tokens) and exits.
   */
  catalog(cwd = homedir()): Promise<ClaudeCatalog> {
    if (this.latestCatalog) return Promise.resolve(this.latestCatalog);
    this.probing ??= new Promise<ClaudeCatalog>((resolve) => {
      const empty: ClaudeCatalog = { commands: [], models: [] };
      let child: ChildProcess;
      try {
        child = spawn(this.opts.bin, [...(this.opts.prefixArgs ?? []), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], {
          cwd,
          env: { ...process.env, ...this.opts.env },
          shell: false,
          stdio: ['pipe', 'pipe', 'ignore'],
          ...treeSpawnOptions,
        });
      } catch {
        return resolve(empty);
      }
      let over = false;
      const done = (cat: ClaudeCatalog) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        child.stdin?.end();
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
        }, 1000);
        resolve(cat);
      };
      const timer = setTimeout(() => done(empty), 20_000);
      let buf = '';
      child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const ev = parseStreamLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (ev?.type === 'control_response' && ev.response.request_id === 'probe-1') {
            const cat = ev.response.subtype === 'success' ? catalogOf(ev.response.response) : null;
            if (cat) this.latestCatalog ??= cat;
            return done(cat ?? empty);
          }
        }
      });
      child.stdin?.on('error', () => {});
      child.on('error', () => done(empty));
      child.on('close', () => done(this.latestCatalog ?? empty));
      child.stdin?.write(JSON.stringify({ type: 'control_request', request_id: 'probe-1', request: { subtype: 'initialize' } }) + '\n');
    }).finally(() => {
      this.probing = undefined;
    });
    return this.probing;
  }

  /** answer an AskUserQuestion; returns how it was delivered */
  async answer(localId: string, toolUseId: string, answers: ClaudeAnswers): Promise<{ via: 'tool' | 'message' }> {
    const e = this.get(localId);
    const ask = e.asks.get(toolUseId);
    if (ask && e.child) {
      e.asks.delete(toolUseId);
      this.write(e, {
        type: 'control_response',
        response: { subtype: 'success', request_id: ask.requestId, response: { behavior: 'allow', updatedInput: { ...ask.input, answers: flattenAnswers(answers) } } },
      });
      e.session = { ...e.session, pendingQuestion: undefined, status: e.session.pendingPermissions.length ? 'waiting' : 'running', activity: 'Thinking…' };
      this.emitState(e);
      return { via: 'tool' };
    }
    // no parked request for it: the tool was not routed to us; answer in plain text instead
    await this.send(localId, answersAsText(answers));
    return { via: 'message' };
  }

  /** allow / deny a pending permission prompt of a tool other than AskUserQuestion */
  permission(localId: string, requestId: string, decision: ClaudePermissionDecision): void {
    const e = this.get(localId);
    const p = e.session.pendingPermissions.find((x) => x.requestId === requestId);
    if (!p) throw new Error(`No pending permission request "${requestId}"`);
    const response = decision.behavior === 'allow' ? { behavior: 'allow', updatedInput: decision.updatedInput ?? p.input } : { behavior: 'deny', message: decision.message ?? 'The user denied this.' };
    this.write(e, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    const pendingPermissions = e.session.pendingPermissions.filter((x) => x.requestId !== requestId);
    e.session = { ...e.session, pendingPermissions, status: pendingPermissions.length || e.session.pendingQuestion ? 'waiting' : 'running' };
    this.emitState(e);
  }

  /** stop the current turn; the process (and session) stays */
  interrupt(localId: string): boolean {
    const e = this.get(localId);
    if (!e.child) return false;
    e.interrupting = true;
    for (const [, ask] of e.asks)
      this.write(e, { type: 'control_response', response: { subtype: 'success', request_id: ask.requestId, response: { behavior: 'deny', message: 'Interrupted by the user.', interrupt: true } } });
    e.asks.clear();
    return this.write(e, { type: 'control_request', request_id: `int-${++seq}`, request: { subtype: 'interrupt' } });
  }

  /** end the process (the session stays listed and can be resumed with `send`) */
  stop(localId: string): Promise<boolean> {
    const e = this.get(localId);
    const child = e.child;
    if (!child) return Promise.resolve(false);
    e.stopping = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => killTree(child.pid), 2000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
      child.stdin?.end(); // a clean EOF lets the CLI flush its transcript
    });
  }

  /** forget a session (stops it first) */
  async remove(localId: string): Promise<boolean> {
    if (!this.entries.has(localId)) return false;
    await this.stop(localId);
    this.entries.delete(localId);
    this.persist();
    return true;
  }

  list(): ClaudeSessionSummary[] {
    return [...this.entries.values()].map((e) => toSummary(e.session));
  }

  /** events of this app run; after a restart, the transcript Claude Code stored on disk */
  transcript(localId: string): ClaudeEvent[] {
    const e = this.get(localId);
    if (e.events.length > 0 || !e.session.sessionId) return e.events;
    return readStoredTranscript(this.opts.projectsDir ?? join(homedir(), '.claude', 'projects'), e.session.cwd, e.session.sessionId);
  }

  /** the full session (with messages) rebuilt from the transcript */
  session(localId: string): ClaudeSession {
    const e = this.get(localId);
    const base = newSession({ localId, cwd: e.session.cwd, title: e.session.title, sessionId: e.session.sessionId, model: e.session.model, permissionMode: e.session.permissionMode, at: e.session.createdAt });
    if (e.events.length > 0) return e.session.messages.length ? e.session : replayTranscript(base, e.events, !!e.child);
    return { ...replayTranscript(base, this.transcript(localId), false), usage: e.session.usage };
  }

  stopAll(): void {
    for (const e of this.entries.values()) {
      if (e.child) {
        e.stopping = true;
        killTree(e.child.pid, { sync: true });
      }
    }
  }
}
