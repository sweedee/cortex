import { describe, expect, it } from 'vitest';
import type { Item, ItemOf, Link } from '../domain';
import { makeCtx } from '../kinds/registry';
import { agentHandle, agentTarget, agentTitle, buildPrompt, contextLine, resolveCwd, skillOf } from './prompt';

const base = { createdAt: 0, updatedAt: 0 };
const project: ItemOf<'project'> = { ...base, id: 'p', kind: 'project', handle: 'cortex', title: 'cortex', data: { repo: 'sweedee/cortex', baseDir: 'C:\\code\\cortex', defaultBranch: 'main' } };
const demoProject: ItemOf<'project'> = { ...base, id: 'p2', kind: 'project', handle: 'demo', title: 'demo', data: { repo: 'x/demo', baseDir: '~/code/demo', defaultBranch: 'main' } };
const ticket: ItemOf<'ticket'> = {
  ...base,
  id: 't',
  kind: 'ticket',
  handle: 'CTX-4821',
  title: 'Retry exporter with backoff',
  projectId: 'p',
  data: { key: 'CTX-4821', status: 'In Progress', statusCategory: 'indeterminate', type: 'Story', branch: 'feat/CTX-4821-retry' },
};
const wt: ItemOf<'worktree'> = {
  ...base,
  id: 'w',
  kind: 'worktree',
  handle: 'wt/retry',
  title: 'feat/CTX-4821-retry',
  projectId: 'p',
  data: { path: 'C:/wt/cortex/retry', branch: 'feat/CTX-4821-retry', baseBranch: 'main', ticketKey: 'CTX-4821' },
};
const pr: ItemOf<'pr'> = { ...base, id: 'pr', kind: 'pr', handle: 'PR-12', title: 'Retry', projectId: 'p', data: { repo: 'sweedee/cortex', number: 12, headBranch: 'feat/x', baseBranch: 'main', state: 'open', isDraft: false } };
const agent: ItemOf<'agent'> = { ...base, id: 'a', kind: 'agent', handle: 'agent/impl', title: 'Implement', projectId: 'p', data: { cwd: 'C:/wt/cortex/retry', status: 'done', localId: 'a' } };
const demoAgent: ItemOf<'agent'> = { ...agent, id: 'a2', handle: 'agent/demo', data: { cwd: '~/x', status: 'running' } };

const ctxWith = (items: Item[], links: Link[] = []) => makeCtx(items, links);

describe('buildPrompt', () => {
  const ctx = ctxWith([project, ticket, wt, pr]);

  it('keeps the draft (and its leading /skill) and adds one context line per mention', () => {
    const p = buildPrompt('/implement @CTX-4821 in @wt/retry please', [ticket, wt], ctx);
    expect(p.startsWith('/implement @CTX-4821 in @wt/retry please\n\nContext')).toBe(true);
    expect(p).toContain('- @CTX-4821 = Jira ticket CTX-4821 "Retry exporter with backoff" (In Progress, Story, branch feat/CTX-4821-retry)');
    expect(p).toContain('- @wt/retry = git worktree at C:/wt/cortex/retry on branch feat/CTX-4821-retry (base main, ticket CTX-4821)');
    expect(skillOf(p)).toBe('implement');
  });

  it('describes projects and PRs', () => {
    expect(contextLine(project, ctx)).toBe('@cortex = project sweedee/cortex checked out at C:\\code\\cortex (default branch main)');
    expect(contextLine(pr, ctx)).toBe('@PR-12 = GitHub pull request sweedee/cortex#12 "Retry" (feat/x → main, open)');
  });

  it('sends the plain draft without mentions', () => {
    expect(buildPrompt('  hello  ', [], ctx)).toBe('hello');
  });
});

describe('resolveCwd', () => {
  it('prefers a mentioned worktree over the project', () => {
    const ctx = ctxWith([project, ticket, wt]);
    expect(resolveCwd([project, wt], ctx)).toMatchObject({ cwd: 'C:/wt/cortex/retry', from: wt, project });
  });

  it('finds the worktree of a mentioned ticket (link or ticket key)', () => {
    expect(resolveCwd([ticket], ctxWith([project, ticket, wt]))).toMatchObject({ cwd: 'C:/wt/cortex/retry', from: ticket, project });
    const other = { ...wt, data: { ...wt.data, ticketKey: undefined } };
    expect(resolveCwd([ticket], ctxWith([project, ticket, other], [{ id: 'l', from: 'w', to: 't', label: 'for' }]))?.cwd).toBe('C:/wt/cortex/retry');
  });

  it('falls back to the project base checkout', () => {
    expect(resolveCwd([pr], ctxWith([project, pr]))).toMatchObject({ cwd: 'C:\\code\\cortex', project });
  });

  it('ignores demo paths and returns null when nothing has a real folder', () => {
    const t2 = { ...ticket, projectId: 'p2' };
    expect(resolveCwd([t2, demoProject], ctxWith([demoProject, t2]))).toBeNull();
    expect(resolveCwd([], ctxWith([]))).toBeNull();
  });
});

describe('agentTarget / naming', () => {
  it('targets exactly one real agent', () => {
    expect(agentTarget([agent, ticket])).toBe(agent);
    expect(agentTarget([agent, { ...agent, id: 'b' }])).toBeNull();
    expect(agentTarget([demoAgent])).toBeNull();
  });

  it('titles and unique handles', () => {
    expect(agentTitle('plan-ticket', ticket)).toBe('Plan CTX-4821');
    expect(agentTitle(undefined, undefined)).toBe('Chat');
    const taken = new Set(['agent/implement-ctx4821']);
    expect(agentHandle('implement', ticket, (h) => taken.has(h))).toBe('agent/implement-ctx4821-2');
  });
});
