import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AppState, RunnerOutputEvent, TestState } from '../../shared/integrations/runners';
import { LogTail, OutputBatcher } from '../lib/batcher';
import { AppRunner, TestRunner } from './runners';

const cwd = mkdtempSync(join(tmpdir(), 'cortex-runners-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));
let n = 0;
/** the user's command line is run through the shell: keep it free of shell syntax by using a script file */
const node = (script: string) => {
  const file = `s${++n}.js`;
  writeFileSync(join(cwd, file), script);
  return `node ${file}`;
};

function collect() {
  const states: (AppState | TestState)[] = [];
  const output: RunnerOutputEvent[] = [];
  const waiters: { pred: (s: AppState | TestState) => boolean; resolve: (s: AppState | TestState) => void }[] = [];
  const send = ((channel: string, payload: unknown) => {
    if (channel.endsWith(':output')) output.push(payload as RunnerOutputEvent);
    else {
      const s = payload as AppState | TestState;
      states.push(s);
      for (const w of waiters.slice()) if (w.pred(s)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(s));
    }
  }) as never;
  const until = <T extends AppState | TestState>(pred: (s: T) => boolean) =>
    new Promise<T>((resolve, reject) => {
      const last = states.at(-1) as T | undefined;
      if (last && pred(last)) return resolve(last);
      waiters.push({ pred: pred as never, resolve: resolve as never });
      setTimeout(() => reject(new Error(`timeout; last: ${JSON.stringify(states.at(-1))}`)), 10_000);
    });
  return { send, states, output, until };
}

describe('OutputBatcher / LogTail', () => {
  it('coalesces chunks per id and stream and flushes on demand', async () => {
    const got: string[] = [];
    const b = new OutputBatcher((id, stream, chunk) => got.push(`${id}/${stream}:${chunk}`), 20);
    b.push('a', 'stdout', '1');
    b.push('a', 'stdout', '2');
    b.push('a', 'stderr', 'e');
    b.push('b', 'stdout', 'x');
    b.flush('b');
    expect(got).toEqual(['b/stdout:x']);
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual(['b/stdout:x', 'a/stdout:12', 'a/stderr:e']);
  });
  it('keeps the tail', () => {
    const t = new LogTail(5);
    t.push('abc');
    t.push('defg');
    expect(t.text()).toBe('cdefg');
  });
});

describe('AppRunner', () => {
  it('detects the URL, batches output and reports a deliberate stop as exited', async () => {
    const c = collect();
    const apps = new AppRunner(c.send, { flushMs: 30 });
    const script = 'let i=0;const t=setInterval(()=>{console.log("line "+(i++));if(i===20){clearInterval(t);console.log("  Local:   http://localhost:"+"5173/");setInterval(()=>{},1000)}},1)';
    const s = apps.start({ id: 'app1', cwd, command: node(script) });
    expect(s.status).toBe('starting');
    expect(() => apps.start({ id: 'app1', cwd, command: 'x' })).toThrow(/already running/);
    const running = await c.until<AppState>((x) => x.status === 'running');
    expect(running.url).toBe('http://localhost:5173/');
    expect(c.output.length).toBeLessThan(15); // 21 lines arrive in a few batched events
    expect(apps.log('app1')).toContain('line 19');
    expect(await apps.stop('app1')).toBe(true);
    expect(apps.list()[0]?.status).toBe('exited');
    const restarted = await apps.restart('app1');
    expect(restarted.status).toBe('starting');
    await c.until<AppState>((x) => x.status === 'running');
    await apps.stop('app1');
    expect(apps.remove('app1')).toBe(true);
  }, 20_000);

  it('reports crashes and counts a URL-less process as running after a while', async () => {
    const c = collect();
    const apps = new AppRunner(c.send, { flushMs: 10, runningAfterMs: 200 });
    apps.start({ id: 'crash', cwd, command: node('console.error("boom");process.exit(2)') });
    const crashed = await c.until<AppState>((x) => x.id === 'crash' && x.status === 'crashed');
    expect(crashed.code).toBe(2);
    apps.start({ id: 'quiet', cwd, command: node('setInterval(()=>{},1000)'), urlHint: 'http://localhost:9999' });
    const quiet = await c.until<AppState>((x) => x.id === 'quiet' && x.status === 'running');
    expect(quiet.url).toBe('http://localhost:9999');
    await apps.stop('quiet');
  }, 20_000);
});

describe('TestRunner', () => {
  it('captures output and parses a summary', async () => {
    const c = collect();
    const tests = new TestRunner(c.send, { flushMs: 10 });
    tests.run({ id: 't1', cwd, command: node('console.log("      Tests  3 passed | 1 failed (4)");process.exit(1)') });
    const done = await c.until<TestState>((x) => x.status !== 'running');
    expect(done).toMatchObject({ status: 'failed', code: 1, summary: { framework: 'vitest', passed: 3, failed: 1, total: 4 } });
    expect(tests.log('t1')).toContain('Tests  3 passed');

    tests.run({ id: 't1', cwd, command: node('console.log("# pass 2");console.log("# fail 0")') });
    expect((await c.until<TestState>((x) => x.status !== 'running')).status).toBe('passed');

    tests.run({ id: 't2', cwd, command: node('setInterval(()=>{},1000)') });
    await new Promise((r) => setTimeout(r, 200));
    expect(tests.stop('t2')).toBe(true);
    expect(await c.until<TestState>((x) => x.id === 't2' && x.status !== 'running')).toMatchObject({ status: 'error', error: 'stopped' });
  }, 20_000);
});
