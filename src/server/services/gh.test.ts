import { describe, expect, it } from 'vitest';
import type { ExecResult } from '../../shared/ipc';
import { DEFAULT_CONFIG } from '../../shared/integrations/config';
import { GH_PR_FIELDS, GH_PR_LIST_FIELDS, summarizePr, type GhPrListItem } from '../../shared/integrations/github';
import type { Runner } from './cli';
import { GhService } from './gh';

/** a list item as gh 2.102 prints it (captured from a real `gh pr list --json …`) */
const LIST_ITEM: GhPrListItem = {
  additions: 3684,
  author: { id: 'U_kgDOBt-yjg', is_bot: false, login: 'sweedee', name: '' },
  baseRefName: 'main',
  deletions: 197,
  headRefName: 'claude/pr-management-ui-features-vgnprp',
  isDraft: false,
  labels: [],
  number: 2,
  reviewDecision: '',
  state: 'MERGED',
  statusCheckRollup: [],
  title: 'Add AI review trigger, rebase button, stacked PRs and a PR creation dialog',
  updatedAt: '2026-11-12T08:21:45Z',
  url: 'https://github.com/sweedee/cortex/pull/2',
};

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false });
const fail = (code: number, stderr: string, stdout = ''): ExecResult => ({ code, stdout, stderr, timedOut: false });

function fake(reply: (args: string[]) => ExecResult) {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    expect(cmd).toBe('gh');
    calls.push(args);
    return reply(args);
  };
  return { gh: new GhService(DEFAULT_CONFIG.github, { run, cwd: process.cwd() }), calls };
}

describe('GhService (fake runner)', () => {
  it('lists PRs with filters', async () => {
    const { gh, calls } = fake(() => ok(JSON.stringify([LIST_ITEM])));
    const prs = await gh.prList('sweedee/cortex', { author: '@me', search: 'is:draft', state: 'all', limit: 5 });
    expect(prs).toEqual([LIST_ITEM]);
    expect(calls[0]).toEqual(['pr', 'list', '--repo', 'sweedee/cortex', '--state', 'all', '--limit', '5', '--json', GH_PR_LIST_FIELDS, '--author', '@me', '--search', 'is:draft']);
    expect(summarizePr(prs[0]!)).toMatchObject({ number: 2, state: 'merged', author: 'sweedee', head: 'claude/pr-management-ui-features-vgnprp', checks: 'none' });
  });

  it('views a PR with merge state', async () => {
    const pr = { ...LIST_ITEM, state: 'OPEN', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', files: [], comments: [], reviewRequests: [], latestReviews: [] };
    const { gh, calls } = fake(() => ok(JSON.stringify(pr)));
    const v = await gh.prView('o/r', 2);
    expect(calls[0]).toEqual(['pr', 'view', '2', '--repo', 'o/r', '--json', GH_PR_FIELDS]);
    expect(summarizePr(v)).toMatchObject({ state: 'open', conflicts: true, behind: false });
  });

  it('creates a (stacked, draft) PR and parses the printed URL', async () => {
    const { gh, calls } = fake(() => ok('Creating pull request for feat/b into feat/a in o/r\n\nhttps://github.com/o/r/pull/43\n'));
    expect(await gh.prCreate('C:/wt/b', { title: 'B', body: 'stacked', base: 'feat/a', head: 'feat/b', draft: true })).toEqual({ number: 43, url: 'https://github.com/o/r/pull/43' });
    expect(calls[0]).toEqual(['pr', 'create', '--title', 'B', '--body', 'stacked', '--base', 'feat/a', '--head', 'feat/b', '--draft']);
  });

  it('merges, comments (AI review default) and reruns', async () => {
    const { gh, calls } = fake(() => ok('https://github.com/o/r/pull/2#issuecomment-1\n'));
    await gh.prMerge('o/r', 2, 'squash', { deleteBranch: true });
    expect(await gh.prComment('o/r', 2)).toEqual({ url: 'https://github.com/o/r/pull/2#issuecomment-1' });
    await gh.prComment('o/r', 2, 'thanks');
    await gh.runRerun('o/r', 99, { failedOnly: true });
    expect(calls).toEqual([
      ['pr', 'merge', '2', '--repo', 'o/r', '--squash', '--delete-branch'],
      ['pr', 'comment', '2', '--repo', 'o/r', '--body', '@claude review'],
      ['pr', 'comment', '2', '--repo', 'o/r', '--body', 'thanks'],
      ['run', 'rerun', '99', '--repo', 'o/r', '--failed'],
    ]);
  });

  it('edits base / title / body', async () => {
    const { gh, calls } = fake(() => ok(''));
    await gh.prEdit({ repo: 'o/r', number: 5, base: 'main' });
    await gh.prEdit({ repo: 'o/r', number: 5, title: 'T', body: 'B' });
    expect(calls).toEqual([
      ['pr', 'edit', '5', '--repo', 'o/r', '--base', 'main'],
      ['pr', 'edit', '5', '--repo', 'o/r', '--title', 'T', '--body', 'B'],
    ]);
  });

  it('turns update-branch conflicts into a result, other failures into errors', async () => {
    let reply = ok('✓ PR branch updated');
    const { gh, calls } = fake(() => reply);
    expect(await gh.prUpdateBranch('o/r', 7, { rebase: true })).toEqual({ ok: true, message: '✓ PR branch updated' });
    expect(calls[0]).toEqual(['pr', 'update-branch', '7', '--repo', 'o/r', '--rebase']);
    reply = fail(1, 'X Cannot update PR branch due to conflicts\n');
    expect(await gh.prUpdateBranch('o/r', 7)).toEqual({ ok: false, conflicts: true, message: 'X Cannot update PR branch due to conflicts' });
    reply = fail(1, 'HTTP 401: Bad credentials');
    await expect(gh.prUpdateBranch('o/r', 7)).rejects.toThrow(/Bad credentials/);
  });

  it('reads checks even when gh exits non-zero (pending = 8, failed = 1)', async () => {
    const checks = [{ name: 'build', state: 'IN_PROGRESS', bucket: 'pending', link: 'https://ci/1', workflow: 'CI', description: '', event: 'pull_request', startedAt: '', completedAt: '' }];
    let reply = fail(8, '', JSON.stringify(checks));
    const { gh } = fake(() => reply);
    expect(await gh.prChecks('o/r', 1)).toEqual(checks);
    reply = fail(1, "no checks reported on the 'x' branch");
    expect(await gh.prChecks('o/r', 1)).toEqual([]);
    reply = fail(1, 'could not find pull request');
    await expect(gh.prChecks('o/r', 1)).rejects.toThrow(/could not find/);
  });

  it('merges Renovate PRs found by app and label', async () => {
    const reno = { ...LIST_ITEM, number: 10, author: { login: 'app/renovate', is_bot: true }, headRefName: 'renovate/major-react' };
    const { gh, calls } = fake((args) => ok(JSON.stringify(args.includes('--app') ? [reno] : [reno, { ...reno, number: 11 }])));
    expect((await gh.renovatePrs('o/r')).map((p) => p.number)).toEqual([10, 11]);
    expect(calls.map((c) => c.slice(-2))).toEqual([
      ['--app', 'renovate'],
      ['--label', 'renovate'],
    ]);
  });
});

// CORTEX_LIVE_GH=1 CORTEX_LIVE_GH_REPO=owner/name npx vitest run src/server/services/gh.test.ts — read-only calls against a real repo
describe.runIf(process.env['CORTEX_LIVE_GH'] === '1' && !!process.env['CORTEX_LIVE_GH_REPO'])('GhService (live, read-only)', () => {
  const repo = process.env['CORTEX_LIVE_GH_REPO'] as string;
  it('lists and views PRs', async () => {
    const gh = new GhService(DEFAULT_CONFIG.github);
    // the repo needs at least one PR (any state)
    const prs = await gh.prList(repo, { state: 'all', limit: 3 });
    expect(prs.length).toBeGreaterThan(0);
    const pr = await gh.prView(repo, prs[0]?.number ?? 0);
    expect(pr.number).toBe(prs[0]?.number);
    expect(typeof pr.mergeStateStatus).toBe('string');
    expect(Array.isArray(pr.files)).toBe(true);
    expect(Array.isArray(await gh.prChecks(repo, pr.number))).toBe(true);
    expect(typeof (await gh.prDiff(repo, pr.number))).toBe('string');
  }, 60_000);
});
