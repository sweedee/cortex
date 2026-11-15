/** End-to-end against a fake `claude` (src/main/services/__fixtures__/fake-claude.mjs): no tokens spent. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClaudeEventMessage, ClaudeSessionSummary } from '../../shared/integrations/claude';
import { ClaudeSessions, projectSlug, readStoredTranscript } from './claude';

const FAKE = join(process.cwd(), 'src/main/services/__fixtures__/fake-claude.mjs');
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-claude-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function manager(store = join(dir, `sessions-${Math.random().toString(36).slice(2)}.json`)) {
  const states: ClaudeSessionSummary[] = [];
  const events: ClaudeEventMessage[] = [];
  const waiters: { pred: (s: ClaudeSessionSummary) => boolean; resolve: (s: ClaudeSessionSummary) => void }[] = [];
  const m = new ClaudeSessions({
    bin: process.execPath,
    prefixArgs: [FAKE],
    storeFile: store,
    projectsDir: join(dir, 'projects'),
    send: ((channel: string, payload: unknown) => {
      if (channel === 'claude:event') events.push(payload as ClaudeEventMessage);
      else {
        const s = payload as ClaudeSessionSummary;
        states.push(s);
        for (const w of waiters.slice()) if (w.pred(s)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(s));
      }
    }) as never,
  });
  const until = (pred: (s: ClaudeSessionSummary) => boolean) =>
    new Promise<ClaudeSessionSummary>((resolve, reject) => {
      const last = states.at(-1);
      if (last && pred(last)) return resolve(last);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error(`timeout; last state: ${JSON.stringify(states.at(-1))}`)), 10_000);
    });
  return { m, states, events, until, store };
}

describe('ClaudeSessions (fake claude process)', () => {
  it('runs a turn, then takes follow-up messages in the same process', async () => {
    const { m, until, events } = manager();
    const s = m.start({ cwd: dir, prompt: 'hello there', model: 'opus', permissionMode: 'acceptEdits', addDirs: [dir], appendSystemPrompt: 'be brief' });
    expect(s.status).toBe('starting');
    expect(s.title).toBe('hello there');
    const idle = await until((x) => x.status === 'idle');
    expect(idle).toMatchObject({ lastText: 'echo: hello there', model: 'opus', running: true });
    expect(idle.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(idle.usage.costUsd).toBeCloseTo(0.01);

    // the flags reached the CLI
    const init = events.find((e) => e.event.type === 'system')!.event as unknown as { argv: string[] };
    expect(init.argv).toEqual(
      expect.arrayContaining([
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-prompt-tool',
        'stdio',
        '--session-id',
        idle.sessionId,
        '--model',
        'opus',
        '--permission-mode',
        'acceptEdits',
        '--add-dir',
        dir,
        '--append-system-prompt',
        'be brief',
      ]),
    );

    m.send(s.localId, 'again');
    const second = await until((x) => x.status === 'idle' && x.lastText === 'echo: again');
    expect(second.usage.costUsd).toBeCloseTo(0.02);
    expect(second.usage.turns).toBe(2);
    expect(
      m
        .session(s.localId)
        .messages.filter((x) => x.role === 'user')
        .map((x) => (x.role === 'user' ? x.text : '')),
    ).toEqual(['hello there', 'again']);
    expect(m.transcript(s.localId).length).toBeGreaterThan(4);

    expect(await m.stop(s.localId)).toBe(true);
    expect((await until((x) => !x.running)).status).toBe('done');
  }, 20_000);

  it('answers AskUserQuestion in-band (can_use_tool → allow with answers)', async () => {
    const { m, until } = manager();
    const s = m.start({ cwd: dir, prompt: 'ask me something' });
    const waiting = await until((x) => x.status === 'waiting');
    expect(waiting.pendingQuestion).toMatchObject({ toolUseId: 'toolu_ask1', questions: [{ question: 'Which approach?', options: [{ label: 'Retry' }, { label: 'Queue' }] }] });
    // the control_request may arrive just after the tool_use; wait until it is parked
    await new Promise((r) => setTimeout(r, 100));
    expect(await m.answer(s.localId, 'toolu_ask1', { 'Which approach?': 'Queue' })).toEqual({ via: 'tool' });
    const idle = await until((x) => x.status === 'idle');
    expect(idle.lastText).toBe('You chose Queue');
    const q = m.session(s.localId).messages.find((x) => x.id === 'toolu_ask1');
    expect(q).toMatchObject({ status: 'ok', answers: { 'Which approach?': 'Queue' } });
    // nothing parked any more → fallback is a plain message
    expect(await m.answer(s.localId, 'toolu_ask1', { 'Which approach?': 'Retry' })).toEqual({ via: 'message' });
    await until((x) => x.status === 'idle' && x.lastText!.startsWith('echo: My answers'));
    await m.stop(s.localId);
  }, 20_000);

  it('handles permission prompts, interrupts and crashes', async () => {
    const { m, until } = manager();
    const s = m.start({ cwd: dir, prompt: 'bash please' });
    const w = await until((x) => x.pendingPermissions.length > 0);
    expect(w.pendingPermissions[0]).toMatchObject({ toolName: 'Bash', input: { command: 'echo hi' } });
    m.permission(s.localId, w.pendingPermissions[0]?.requestId ?? '', { behavior: 'deny', message: 'no' });
    expect((await until((x) => x.status === 'idle')).lastText).toBe('denied');

    m.send(s.localId, 'slow job');
    await until((x) => x.activity === 'Reading /x.ts');
    expect(m.interrupt(s.localId)).toBe(true);
    const interrupted = await until((x) => x.status === 'idle' && x.activity === 'Interrupted');
    expect(interrupted.error).toBeUndefined();

    m.send(s.localId, 'crash now');
    const failed = await until((x) => !x.running);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/something broke/);
  }, 20_000);

  it('persists metadata and resumes with --resume after a restart', async () => {
    const first = manager();
    const s = first.m.start({ cwd: dir, prompt: 'remember me', title: 'My session' });
    const idle = await first.until((x) => x.status === 'idle');
    await first.m.stop(s.localId);
    await first.until((x) => !x.running);
    await first.m.flush();
    const stored = JSON.parse(readFileSync(first.store, 'utf8'));
    expect(stored).toEqual([expect.objectContaining({ localId: s.localId, sessionId: idle.sessionId, title: 'My session', cwd: dir })]);

    // a stored Claude transcript for that session (as Claude Code writes it)
    const pdir = join(dir, 'projects', projectSlug(dir));
    mkdirSync(pdir, { recursive: true });
    writeFileSync(
      join(pdir, `${idle.sessionId}.jsonl`),
      [
        JSON.stringify({ type: 'permission-mode', permissionMode: 'default' }),
        JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<caveat>' } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'remember me' } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo: remember me' }] } }),
      ].join('\n'),
    );

    const second = manager(first.store);
    const [restored] = second.m.list();
    expect(restored).toMatchObject({ localId: s.localId, sessionId: idle.sessionId, status: 'done', running: false, title: 'My session' });
    expect(second.m.transcript(s.localId).map((e) => e.type)).toEqual(['user', 'assistant']);
    expect(second.m.session(s.localId).messages.map((x) => (x.role === 'tool' ? '' : x.text))).toEqual(['remember me', 'echo: remember me']);
    expect(readStoredTranscript(join(dir, 'projects'), 'C:/elsewhere', idle.sessionId!)).toHaveLength(2); // found by id in any folder

    second.m.send(s.localId, 'back again');
    const resumed = await second.until((x) => x.status === 'idle');
    expect(resumed.sessionId).toBe(idle.sessionId);
    const init = second.events.find((e) => e.event.type === 'system')!.event as unknown as { argv: string[] };
    expect(init.argv).toEqual(expect.arrayContaining(['--resume', idle.sessionId]));
    expect(await second.m.remove(s.localId)).toBe(true);
    expect(second.m.list()).toEqual([]);
  }, 20_000);

  it('changes model / permission mode / effort live; max effort restarts with the next message', async () => {
    const { m, until, events } = manager();
    const s = m.start({ cwd: dir, prompt: 'hello', model: 'haiku' });
    const idle = await until((x) => x.status === 'idle');
    expect(idle.usage).toMatchObject({ contextWindow: 200_000, turns: 1 });
    expect(idle.usage.contextTokens).toBeGreaterThan(12_000);
    expect(idle.cliVersion).toBe('0.0.0-fake');
    expect(m.session(s.localId).commands?.map((c) => c.name)).toContain('fake-skill');
    expect((await m.catalog()).models.map((x) => x.value)).toContain('sonnet');

    expect(m.configure(s.localId, { model: 'sonnet', permissionMode: 'plan', effort: 'low' })).toEqual({ model: 'live', permissionMode: 'live', effort: 'live' });
    const switched = await until((x) => x.model === 'claude-sonnet-fake' && x.permissionMode === 'plan');
    expect(switched.restartPending).toBeUndefined();
    expect(m.session(s.localId).messages.some((x) => x.role === 'note' && x.text.includes('claude-sonnet-fake'))).toBe(true);

    expect(m.configure(s.localId, { effort: 'max' })).toEqual({ effort: 'restart' });
    expect(m.list()[0]).toMatchObject({ effort: 'max', restartPending: ['effort'] });
    await m.send(s.localId, 'next');
    await until((x) => x.status === 'idle' && x.lastText === 'echo: next');
    const inits = events.filter((e) => e.event.type === 'system' && (e.event as { subtype?: string }).subtype === 'init').map((e) => (e.event as unknown as { argv: string[] }).argv);
    const last = inits.at(-1)!;
    expect(last).toEqual(expect.arrayContaining(['--resume', idle.sessionId, '--effort', 'max', '--model', 'sonnet', '--permission-mode', 'plan']));
    expect(m.list()[0]?.restartPending).toBeUndefined();
    await m.stop(s.localId);
    // no process: applies on resume
    expect(m.configure(s.localId, { model: null })).toEqual({ model: 'next' });
  }, 20_000);

  it('tracks subagents and nests their tool calls', async () => {
    const { m, until } = manager();
    const s = m.start({ cwd: dir, prompt: 'agent please' });
    const running = await until((x) => x.subagents.some((a) => a.status === 'running' && a.toolUses > 0));
    expect(running.subagents[0]).toMatchObject({ toolUseId: 'toolu_task1', description: 'Map the code', type: 'Explore' });
    const idle = await until((x) => x.status === 'idle');
    expect(idle.subagents).toMatchObject([{ status: 'done', toolUses: 2, tokens: 19000 }]);
    const nested = m.session(s.localId).messages.filter((x) => x.parent === 'toolu_task1');
    expect(nested.map((x) => (x.role === 'tool' ? x.tool : x.role))).toEqual(['Glob', 'Read', 'assistant']);
    expect(idle.lastText).toBe('The subagent found 2 files.');
    await m.stop(s.localId);
  }, 20_000);

  it('probes the CLI for its catalog before any session', async () => {
    const { m } = manager();
    const cat = await m.catalog(dir);
    expect(cat.commands.map((c) => c.name)).toEqual(['compact', 'review', 'fake-skill']);
    expect(cat.cliVersion).toBe('0.0.0-fake');
  }, 20_000);

  it('reports a binary that cannot be started', async () => {
    const states: ClaudeSessionSummary[] = [];
    const m = new ClaudeSessions({ bin: join(dir, 'no-such-claude.exe'), send: ((_c: string, p: unknown) => states.push(p as ClaudeSessionSummary)) as never });
    m.start({ cwd: dir, prompt: 'x' });
    await new Promise((r) => setTimeout(r, 1000));
    expect(states.at(-1)).toMatchObject({ status: 'failed', running: false });
    expect(states.at(-1)?.error).toMatch(/Could not start|ENOENT/);
  });
});
