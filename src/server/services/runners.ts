/**
 * Apps (dev servers) and test runs: thin, typed layers over `ProcManager` with the user's
 * command line run through the shell. Output is batched (`OutputBatcher`) and kept as a tail.
 */
import type { EventChannels, ProcExitEvent, ProcOutputEvent } from '../../shared/ipc';
import { detectLocalUrl, parseTestSummary, type AppStartRequest, type AppState, type RunnerOutputEvent, type TestRunRequest, type TestState } from '../../shared/integrations/runners';
import { LogTail, OutputBatcher } from '../lib/batcher';
import { ProcManager } from '../lib/procManager';

type ProcEmit = ConstructorParameters<typeof ProcManager>[0];

/** shared core: a ProcManager whose output is batched and whose exits are routed per id */
class Runner {
  readonly procs: ProcManager;
  private batcher: OutputBatcher;
  private onExit: (e: ProcExitEvent) => void;
  private onChunk: (e: ProcOutputEvent) => void;

  constructor(opts: { flushMs: number; output: (e: RunnerOutputEvent) => void; chunk: (e: ProcOutputEvent) => void; exit: (e: ProcExitEvent) => void }) {
    this.batcher = new OutputBatcher((id, stream, chunk) => opts.output({ id, stream, chunk }), opts.flushMs);
    this.onExit = opts.exit;
    this.onChunk = opts.chunk;
    const emit: ProcEmit = (channel, payload) => {
      if (channel === 'proc:output') {
        const e = payload as ProcOutputEvent;
        this.onChunk(e);
        this.batcher.push(e.id, e.stream, e.chunk);
      } else {
        const e = payload as ProcExitEvent;
        this.batcher.flush(e.id);
        this.onExit(e);
      }
    };
    this.procs = new ProcManager(emit);
  }
}

type Send = <C extends 'app:state' | 'app:output' | 'test:state' | 'test:output'>(channel: C, payload: EventChannels[C]) => void;

export class AppRunner {
  private apps = new Map<string, { state: AppState; req: AppStartRequest; log: LogTail; stopping: boolean; timer?: ReturnType<typeof setTimeout> }>();
  private core: Runner;
  private send: Send;
  private runningAfterMs: number;

  constructor(send: Send, opts: { flushMs?: number; runningAfterMs?: number } = {}) {
    this.send = send;
    this.runningAfterMs = opts.runningAfterMs ?? 8000;
    this.core = new Runner({
      flushMs: opts.flushMs ?? 100,
      output: (e) => this.send('app:output', e),
      chunk: (e) => this.chunk(e),
      exit: (e) => this.exited(e),
    });
  }

  private update(id: string, patch: Partial<AppState>) {
    const a = this.apps.get(id);
    if (!a) return;
    a.state = { ...a.state, ...patch };
    this.send('app:state', a.state);
  }

  private chunk(e: ProcOutputEvent) {
    const a = this.apps.get(e.id);
    if (!a) return;
    // look at the end of the previous output too: a URL can be split across chunks
    const before = a.log.text().slice(-200);
    a.log.push(e.chunk);
    if (a.state.status === 'starting' || !a.state.url || a.state.url === a.req.urlHint) {
      const url = detectLocalUrl(before.slice(before.lastIndexOf('\n') + 1) + e.chunk);
      if (url && url !== a.state.url) {
        clearTimeout(a.timer);
        this.update(e.id, { url, status: 'running' });
      }
    }
  }

  private exited(e: ProcExitEvent) {
    const a = this.apps.get(e.id);
    if (!a) return;
    clearTimeout(a.timer);
    // a deliberate stop (or a clean exit) is "exited"; anything else is a crash
    const crashed = !a.stopping && (e.code !== 0 || !!e.error);
    this.update(e.id, { status: crashed ? 'crashed' : 'exited', code: e.code, exitedAt: Date.now(), ...(e.error ? { error: e.error } : {}) });
  }

  start(req: AppStartRequest): AppState {
    const prev = this.apps.get(req.id);
    if (prev && (prev.state.status === 'starting' || prev.state.status === 'running')) throw new Error(`App "${req.id}" is already running`);
    const info = this.core.procs.start({ id: req.id, cmd: req.command, args: [], cwd: req.cwd, env: { FORCE_COLOR: '0', ...req.env }, shell: true });
    const state: AppState = { id: req.id, cwd: req.cwd, command: req.command, status: 'starting', url: req.urlHint, pid: info.pid, startedAt: info.startedAt };
    const entry = { state, req, log: new LogTail(), stopping: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.apps.set(req.id, entry);
    // no URL in the output (a worker, a CLI watch task): alive for a while = running
    entry.timer = setTimeout(() => {
      if (this.apps.get(req.id) === entry && entry.state.status === 'starting') this.update(req.id, { status: 'running' });
    }, this.runningAfterMs);
    this.send('app:state', state);
    return state;
  }

  /** resolves once the process is gone */
  stop(id: string): Promise<boolean> {
    const a = this.apps.get(id);
    if (!a || (a.state.status !== 'starting' && a.state.status !== 'running')) return Promise.resolve(false);
    a.stopping = true;
    return new Promise((resolve) => {
      const started = Date.now();
      const done = setInterval(() => {
        const gone = a.state.status === 'exited' || a.state.status === 'crashed';
        if (gone || Date.now() - started > 15_000) {
          clearInterval(done);
          resolve(gone);
        }
      }, 50);
      this.core.procs.stop(id);
    });
  }

  async restart(id: string): Promise<AppState> {
    const a = this.apps.get(id);
    if (!a) throw new Error(`Unknown app "${id}"`);
    await this.stop(id);
    return this.start(a.req);
  }

  list(): AppState[] {
    return [...this.apps.values()].map((a) => a.state);
  }

  log(id: string): string {
    return this.apps.get(id)?.log.text() ?? '';
  }

  /** forget an exited app */
  remove(id: string): boolean {
    const a = this.apps.get(id);
    if (!a || a.state.status === 'starting' || a.state.status === 'running') return false;
    return this.apps.delete(id);
  }

  stopAll() {
    this.core.procs.stopAll();
  }
}

export class TestRunner {
  private runs = new Map<string, { state: TestState; req: TestRunRequest; log: LogTail; full: string[]; stopped: boolean }>();
  private core: Runner;
  private send: Send;

  constructor(send: Send, opts: { flushMs?: number } = {}) {
    this.send = send;
    this.core = new Runner({
      flushMs: opts.flushMs ?? 100,
      output: (e) => this.send('test:output', e),
      chunk: (e) => {
        const r = this.runs.get(e.id);
        if (!r) return;
        r.log.push(e.chunk);
        // the summary parser wants everything; cap at ~5 MB
        if (r.full.length < 50_000) r.full.push(e.chunk);
      },
      exit: (e) => this.exited(e),
    });
  }

  private exited(e: ProcExitEvent) {
    const r = this.runs.get(e.id);
    if (!r) return;
    const summary = parseTestSummary(r.full.join(''));
    r.full = [];
    const status: TestState['status'] = e.error || r.stopped ? 'error' : e.code === 0 ? (summary && summary.failed > 0 ? 'failed' : 'passed') : 'failed';
    r.state = { ...r.state, status, summary, code: e.code, finishedAt: Date.now(), ...(e.error ? { error: e.error } : r.stopped ? { error: 'stopped' } : {}) };
    this.send('test:state', r.state);
  }

  run(req: TestRunRequest): TestState {
    const prev = this.runs.get(req.id);
    if (prev?.state.status === 'running') throw new Error(`Test run "${req.id}" is still running`);
    const info = this.core.procs.start({ id: req.id, cmd: req.command, args: [], cwd: req.cwd, env: { FORCE_COLOR: '0', CI: '1', ...req.env }, shell: true });
    const state: TestState = { id: req.id, cwd: req.cwd, command: req.command, status: 'running', pid: info.pid, startedAt: info.startedAt };
    this.runs.set(req.id, { state, req, log: new LogTail(), full: [], stopped: false });
    this.send('test:state', state);
    return state;
  }

  stop(id: string): boolean {
    const r = this.runs.get(id);
    if (!r || r.state.status !== 'running') return false;
    r.stopped = true;
    return this.core.procs.stop(id);
  }

  list(): TestState[] {
    return [...this.runs.values()].map((r) => r.state);
  }

  log(id: string): string {
    return this.runs.get(id)?.log.text() ?? '';
  }

  stopAll() {
    this.core.procs.stopAll();
  }
}
