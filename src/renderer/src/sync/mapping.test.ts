import { beforeEach, describe, expect, it } from 'vitest';
import '../kinds/registry';
import { NO_USAGE, type ClaudeSessionSummary } from '../../../shared/integrations/claude';
import type { GhPullRequest } from '../../../shared/integrations/github';
import type { JiraIssue } from '../../../shared/integrations/jira';
import type { AppState, TestState } from '../../../shared/integrations/runners';
import { DEFAULT_PREFS, type AgentData, type AppData, type Item, type TestRunData } from '../domain';
import { addItem, getState, itemById, replaceWorld } from '../store';
import { onClaudeState } from '../kinds/agent/live';
import { onTestState } from '../kinds/testrun/live';
import { reconcile } from './live';
import { agentStatusOf, changes, mapAppState, mapClaudeState, mapTestState, prPatch, tailOf, ticketPatch, worktreeGitPatch } from './mapping';

const session = (over: Partial<ClaudeSessionSummary> = {}): ClaudeSessionSummary => ({
  localId: 'a1',
  sessionId: 'sess-1',
  cwd: 'C:/repo',
  title: 'Implement',
  model: 'claude-x',
  status: 'running',
  pendingPermissions: [],
  subagents: [],
  usage: { ...NO_USAGE, contextTokens: 50_000, costUsd: 0.25, turns: 2 },
  running: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const agent = (over: Partial<AgentData> = {}): AgentData => ({ cwd: 'C:/repo', status: 'running', localId: 'a1', ...over });

describe('claude:state → agent', () => {
  it('maps status, usage and activity', () => {
    const { patch, notice } = mapClaudeState(session({ activity: 'Editing src/x.ts' }), agent(), 'Implement');
    expect(patch).toMatchObject({ status: 'running', sessionId: 'sess-1', model: 'claude-x', lastActivity: 'Editing src/x.ts', usage: { contextPct: 25, costUsd: 0.25, turns: 2 } });
    expect(patch.pendingQuestion).toBeUndefined();
    expect(notice).toBeUndefined();
  });

  it('a question → waiting + warning notice, once', () => {
    const q = { toolUseId: 'tu1', questions: [{ question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'Retry' }, { label: 'Queue' }] }] };
    const m = mapClaudeState(session({ status: 'waiting', pendingQuestion: q }), agent(), 'Implement');
    expect(m.patch.status).toBe('waiting');
    expect(m.patch.pendingQuestion).toEqual({ toolUseId: 'tu1', questions: [{ question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'Retry' }, { label: 'Queue' }] }] });
    expect(m.notice).toEqual({ tone: 'warning', text: 'Implement asks: Which approach?' });
    expect(mapClaudeState(session({ status: 'waiting', pendingQuestion: q }), agent({ status: 'waiting' }), 'Implement').notice).toBeUndefined();
  });

  it('a permission prompt → waiting with pendingPermissions', () => {
    const m = mapClaudeState(session({ status: 'waiting', pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: { command: 'npm test' } }] }), agent(), 'Fix');
    expect(m.patch.pendingPermissions).toEqual([{ requestId: 'r1', toolName: 'Bash', summary: 'npm test' }]);
    expect(m.notice).toEqual({ tone: 'warning', text: 'Fix needs permission to use Bash' });
  });

  it('turn finished → done + success; failure → critical; interrupt → idle', () => {
    const done = mapClaudeState(session({ status: 'idle', running: true, lastText: 'All set.\nDetails…' }), agent(), 'Implement', 1000);
    expect(done.patch).toMatchObject({ status: 'done', lastActivity: 'All set.', endedAt: 1000 });
    expect(done.notice?.tone).toBe('success');
    const failed = mapClaudeState(session({ status: 'failed', error: 'claude exited with code 3' }), agent(), 'Implement');
    expect(failed.patch).toMatchObject({ status: 'failed', error: 'claude exited with code 3' });
    expect(failed.notice).toEqual({ tone: 'critical', text: 'Implement failed: claude exited with code 3' });
    expect(agentStatusOf(session({ status: 'idle', activity: 'Interrupted' }), 'running')).toBe('idle');
  });

  it('process gone: stopped mid-turn = idle, a finished one stays done', () => {
    expect(agentStatusOf(session({ status: 'done', running: false }), 'running')).toBe('idle');
    expect(agentStatusOf(session({ status: 'done', running: false }), 'done')).toBe('done');
    expect(mapClaudeState(session({ status: 'done' }), agent({ status: 'done', endedAt: 5 }), 'x').notice).toBeUndefined();
  });
});

describe('app:state / test:state', () => {
  const app = (over: Partial<AppState>): AppState => ({ id: 'app1', cwd: 'C:/repo', command: 'npm run dev', status: 'starting', startedAt: 1, ...over });
  const prevApp: AppData = { command: 'npm run dev', cwd: 'C:/repo', state: 'starting' };

  it('maps app state, url and port; a crash is critical', () => {
    expect(mapAppState(app({ status: 'running', url: 'http://localhost:5173/' }), prevApp).patch).toMatchObject({ state: 'running', url: 'http://localhost:5173/', port: 5173, procId: 'app1' });
    expect(mapAppState(app({ status: 'exited' }), { ...prevApp, state: 'running' })).toMatchObject({ patch: { state: 'stopped' }, notice: undefined });
    expect(mapAppState(app({ status: 'crashed', code: 1 }), { ...prevApp, state: 'running' }).notice).toEqual({ tone: 'critical', text: 'Crashed (exit code 1)' });
  });

  const test = (over: Partial<TestState>): TestState => ({ id: 't1', cwd: 'C:/repo', command: 'npm test', status: 'running', startedAt: 1, ...over });
  const prevTest: TestRunData = { command: 'npm test', cwd: 'C:/repo', state: 'running' };

  it('maps test results with notices', () => {
    const failed = mapTestState(test({ status: 'failed', summary: { framework: 'vitest', passed: 40, failed: 2, skipped: 1, total: 43 }, finishedAt: 9 }), prevTest);
    expect(failed.patch).toMatchObject({ state: 'failed', summary: { passed: 40, failed: 2, skipped: 1 }, endedAt: 9 });
    expect(failed.notice).toEqual({ tone: 'critical', text: '2 tests failed' });
    expect(mapTestState(test({ status: 'passed', summary: { framework: 'vitest', passed: 5, failed: 0, skipped: 0, total: 5 } }), prevTest).notice).toEqual({ tone: 'success', text: 'All 5 tests passed' });
    expect(mapTestState(test({ status: 'error', error: 'stopped' }), prevTest)).toMatchObject({ patch: { state: 'stopped' }, notice: undefined });
    // a new run clears the old tail and summary
    expect(mapTestState(test({}), { ...prevTest, state: 'failed', outputTail: 'old', summary: { passed: 1, failed: 1, skipped: 0 } }).patch).toMatchObject({ state: 'running', summary: undefined, outputTail: undefined });
  });

  it('tailOf keeps the end, cut at a line', () => {
    const t = tailOf('a'.repeat(50) + '\nline two\nline three', 20);
    expect(t).toBe('line two\nline three');
  });
});

describe('refresher mappings', () => {
  it('gh pr view → PR cache with check counts', () => {
    const pr = {
      state: 'OPEN',
      isDraft: false,
      author: { login: 'app/renovate', is_bot: true },
      headRefName: 'renovate/vite',
      baseRefName: 'main',
      reviewDecision: 'APPROVED',
      latestReviews: [{ author: { login: 'a' }, state: 'APPROVED' }],
      reviewRequests: [{ login: 'b' }],
      mergeable: 'MERGEABLE',
      additions: 3,
      deletions: 1,
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' },
        { __typename: 'StatusContext', context: 'jenkins', state: 'FAILURE' },
      ],
    } as unknown as GhPullRequest;
    expect(prPatch(pr)).toEqual({
      state: 'open',
      isDraft: false,
      author: 'renovate[bot]',
      headBranch: 'renovate/vite',
      baseBranch: 'main',
      reviewDecision: 'APPROVED',
      reviews: { approved: 1, requested: 1 },
      mergeable: 'MERGEABLE',
      checks: { state: 'failure', passed: 1, failed: 1, pending: 1 },
      additions: 3,
      deletions: 1,
    });
  });

  it('gh pr view → mergeStateStatus is kept (DIRTY = conflicts)', () => {
    const pr = { state: 'OPEN', isDraft: false, headRefName: 'b', baseRefName: 'main', reviewDecision: '', mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY' } as unknown as GhPullRequest;
    expect(prPatch(pr)).toMatchObject({ mergeable: 'UNKNOWN', mergeStateStatus: 'DIRTY', checks: { state: 'none' } });
  });

  it('jira view → ticket cache + title', () => {
    const issue = {
      key: 'CTX-1',
      self: 'https://x/rest/api/3/issue/1',
      fields: { summary: 'Retry exporter', status: { name: 'In Review', statusCategory: { key: 'indeterminate' } }, issuetype: { name: 'Bug' }, priority: { name: 'High' }, assignee: { displayName: 'Me' }, updated: '', customfield_10016: 3 },
    } as unknown as JiraIssue;
    expect(ticketPatch(issue)).toEqual({ title: 'Retry exporter', patch: { status: 'In Review', statusCategory: 'indeterminate', type: 'Bug', priority: 'High', assignee: 'Me', sprint: undefined, points: 3 } });
  });

  it('git status → worktree stats; unchanged stats are no change', () => {
    const st = { branch: 'feat/x', head: 'abc', upstream: null, ahead: 0, behind: 0, dirty: true, files: [{ path: 'a', index: '.', worktree: 'M', kind: 'changed' as const }] };
    const p = worktreeGitPatch(st, { ahead: 2, behind: 5 }, 7);
    expect(p).toEqual({ git: { ahead: 2, behind: 5, dirty: true, changedFiles: 1, checkedAt: 7 }, branch: 'feat/x' });
    const wt = { path: 'C:/wt', baseBranch: 'main', branch: 'feat/x' };
    expect(changes({ ...wt, git: { ahead: 2, behind: 5, dirty: true, changedFiles: 1, checkedAt: 1 } }, p)).toBe(false);
    expect(changes({ ...wt, git: { ahead: 2, behind: 4, dirty: true, changedFiles: 1 } }, p)).toBe(true);
  });
});

describe('live sync → store', () => {
  const mk = (id: string, data: Partial<AgentData> & Pick<AgentData, 'status'>): Item =>
    ({ id, kind: 'agent', handle: id, title: `Agent ${id}`, createdAt: 0, updatedAt: 0, data: { cwd: 'C:/repo', ...data } }) as Item;

  beforeEach(() => replaceWorld([], [], DEFAULT_PREFS));

  it('patches the agent with that localId and raises the notice', () => {
    addItem(mk('ag', { status: 'running', localId: 'a1' }));
    addItem(mk('other', { status: 'running', localId: 'zz' }));
    onClaudeState(session({ status: 'idle', lastText: 'Done!' }));
    const a = itemById('ag');
    expect(a?.kind === 'agent' && a.data.status).toBe('done');
    expect(a?.notice).toMatchObject({ tone: 'success', read: false });
    expect(itemById('other')?.kind === 'agent' && (itemById('other') as Extract<Item, { kind: 'agent' }>).data.status).toBe('running');
  });

  it('test:state patches the run by procId', () => {
    addItem({ id: 'tr', kind: 'testrun', handle: 'tr', title: 'tests', data: { command: 'npm test', cwd: 'C:/r', state: 'idle', procId: 'tr' } });
    onTestState({ id: 'tr', cwd: 'C:/r', command: 'npm test', status: 'passed', startedAt: 1, finishedAt: 2, summary: { framework: 'vitest', passed: 3, failed: 0, skipped: 0, total: 3 } });
    const t = itemById('tr');
    expect(t?.kind === 'testrun' && t.data).toMatchObject({ state: 'passed', summary: { passed: 3 } });
    expect(t?.notice?.tone).toBe('success');
  });

  it('reconcile: unknown running items stop, known ones take main state, demo items stay', async () => {
    addItem(mk('gone', { status: 'running', localId: 'missing' }));
    addItem(mk('known', { status: 'running', localId: 'a1' }));
    addItem(mk('demo', { status: 'running' }));
    addItem({ id: 'app', kind: 'app', handle: 'app', title: 'app', data: { command: 'x', cwd: 'C:/r', state: 'running', procId: 'app' } });
    await reconcile({ agent: [session({ status: 'done', running: false })], app: [], testrun: [] });
    const data = (id: string) => (getState().items.find((i) => i.id === id) as Extract<Item, { kind: 'agent' }>).data;
    expect(data('gone')).toMatchObject({ status: 'idle', lastActivity: 'Stopped (app restarted)' });
    expect(data('known').status).toBe('idle');
    expect(data('demo').status).toBe('running');
    expect((itemById('app') as Extract<Item, { kind: 'app' }>).data.state).toBe('stopped');
    // reconciliation never raises notices
    expect(getState().items.some((i) => i.notice)).toBe(false);
  });
});
