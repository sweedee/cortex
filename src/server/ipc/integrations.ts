import { allowedUnattendedModes, ModeGate } from '../lib/modeGate';
import type { Roots } from '../lib/pathPolicy';
import type { Services } from '../services';
import { handle, type IpcContext } from './handle';

/** `integrations:*`, `git:*`, `gh:*`, `jira:*`, `claude:*`, `apps:*`, `tests:*`. */
export function registerIntegrations(ctx: IpcContext, s: Services, roots: Roots) {
  void s.initJira();
  // waits (at most 10 s) for the Jira site from `acli jira auth status`
  handle(ctx, 'integrations:config', async () => {
    await Promise.race([s.initJira(), new Promise((r) => setTimeout(r, 10_000))]);
    return s.config;
  });

  const { git, gh, jira, claude, apps, tests } = s;
  handle(ctx, 'git:isRepo', ({ dir }) => git.isRepo(dir));
  handle(ctx, 'git:currentBranch', ({ dir }) => git.currentBranch(dir));
  handle(ctx, 'git:remoteRepo', ({ dir, remote }) => git.remoteRepo(dir, remote));
  handle(ctx, 'git:worktreeList', ({ repoDir }) => git.worktreeList(repoDir));
  handle(ctx, 'git:worktreeAdd', ({ repoDir, path, branch, base, newBranch }) => git.worktreeAdd(repoDir, path, branch, base, { newBranch }));
  handle(ctx, 'git:worktreeRemove', ({ repoDir, path, force }) => git.worktreeRemove(repoDir, path, { force }));
  handle(ctx, 'git:status', ({ dir }) => git.status(dir));
  handle(ctx, 'git:diff', ({ dir, ...opts }) => git.diff(dir, opts));
  handle(ctx, 'git:diffStat', ({ dir, ...opts }) => git.diffStat(dir, opts));
  handle(ctx, 'git:log', ({ dir, ...opts }) => git.log(dir, opts));
  handle(ctx, 'git:fetch', ({ dir, ...opts }) => git.fetch(dir, opts));
  handle(ctx, 'git:rebase', ({ dir, onto }) => git.rebase(dir, onto));
  handle(ctx, 'git:rebaseAbort', ({ dir }) => git.rebaseAbort(dir));
  handle(ctx, 'git:push', ({ dir, ...opts }) => git.push(dir, opts));

  handle(ctx, 'gh:prList', ({ repo, ...filter }) => gh.prList(repo, filter));
  handle(ctx, 'gh:prView', ({ repo, number }) => gh.prView(repo, number));
  handle(ctx, 'gh:prCreate', ({ dir, ...pr }) => gh.prCreate(dir, pr));
  handle(ctx, 'gh:prMerge', ({ repo, number, method, deleteBranch }) => gh.prMerge(repo, number, method, { deleteBranch }));
  handle(ctx, 'gh:prComment', ({ repo, number, body }) => gh.prComment(repo, number, body));
  handle(ctx, 'gh:prUpdateBranch', ({ repo, number, rebase }) => gh.prUpdateBranch(repo, number, { rebase }));
  handle(ctx, 'gh:prEdit', (req) => gh.prEdit(req));
  handle(ctx, 'gh:prDiff', ({ repo, number }) => gh.prDiff(repo, number));
  handle(ctx, 'gh:prChecks', ({ repo, number }) => gh.prChecks(repo, number));
  handle(ctx, 'gh:runView', ({ repo, runId }) => gh.runView(repo, runId));
  handle(ctx, 'gh:runRerun', ({ repo, runId, failedOnly }) => gh.runRerun(repo, runId, { failedOnly }));
  handle(ctx, 'gh:renovatePrs', ({ repo }) => gh.renovatePrs(repo));

  // after initJira: acli may have been swapped for the mock
  const ready = () => s.initJira();
  handle(ctx, 'jira:search', async ({ jql, limit }) => (await ready(), jira.search(jql, { limit })));
  handle(ctx, 'jira:view', async ({ key }) => (await ready(), jira.view(key)));
  handle(ctx, 'jira:transition', async ({ key, status }) => (await ready(), jira.transition(key, status)));
  handle(ctx, 'jira:create', async (req) => (await ready(), jira.create(req)));
  handle(ctx, 'jira:comment', async ({ key, body }) => (await ready(), jira.comment(key, body)));
  handle(ctx, 'jira:edit', async (req) => (await ready(), jira.edit(req)));
  handle(ctx, 'jira:statuses', async ({ project }) => (await ready(), jira.statuses(project)));

  // bypassPermissions / dontAsk from the renderer: allowed only when the person who started the server
  // said so (CORTEX_ALLOW_UNATTENDED, lib/modeGate.ts). The page shows untrusted content and the server
  // has no UI of its own to ask in, so the renderer can't switch an agent to "run anything" by itself.
  const modes = new ModeGate(allowedUnattendedModes(process.env));
  handle(ctx, 'claude:start', async (req) => (await modes.require(req.permissionMode), claude.start(req)));
  handle(ctx, 'claude:send', ({ localId, text }) => claude.send(localId, text));
  handle(ctx, 'claude:answer', ({ localId, toolUseId, answers }) => claude.answer(localId, toolUseId, answers));
  handle(ctx, 'claude:permission', ({ localId, requestId, decision }) => claude.permission(localId, requestId, decision));
  handle(ctx, 'claude:interrupt', ({ localId }) => claude.interrupt(localId));
  handle(ctx, 'claude:stop', ({ localId }) => claude.stop(localId));
  handle(ctx, 'claude:remove', ({ localId }) => claude.remove(localId));
  handle(ctx, 'claude:list', () => claude.list());
  handle(ctx, 'claude:transcript', ({ localId }) => claude.transcript(localId));
  handle(ctx, 'claude:session', ({ localId }) => claude.session(localId));
  handle(ctx, 'claude:configure', async ({ localId, ...c }) => (await modes.require(c.permissionMode), claude.configure(localId, c)));
  handle(ctx, 'claude:catalog', () => claude.catalog());

  // user command lines through the shell: only in a project / worktree folder
  handle(ctx, 'apps:start', (req) => (roots.check(req.cwd, 'cwd'), apps.start(req)));
  handle(ctx, 'apps:stop', ({ id }) => apps.stop(id));
  handle(ctx, 'apps:restart', ({ id }) => apps.restart(id));
  handle(ctx, 'apps:list', () => apps.list());
  handle(ctx, 'apps:log', ({ id }) => apps.log(id));
  handle(ctx, 'apps:remove', ({ id }) => apps.remove(id));

  handle(ctx, 'tests:run', (req) => (roots.check(req.cwd, 'cwd'), tests.run(req)));
  handle(ctx, 'tests:stop', ({ id }) => tests.stop(id));
  handle(ctx, 'tests:list', () => tests.list());
  handle(ctx, 'tests:log', ({ id }) => tests.log(id));

  // no orphaned agents / dev servers / test runs: index.ts calls s.stopAll() on shutdown
}
