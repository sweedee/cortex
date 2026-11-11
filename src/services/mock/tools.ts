/**
 * Mock implementations of every service except Claude (see ./claude.ts).
 * They answer from the in-memory world, with a little latency, in the real tools' formats.
 */
import { makeQueuedPipeline } from '../../mock/seed/pipelines';
import { makeDraftPr } from '../../mock/seed/prs';
import type { PullRequest, TicketStatus, WorkItem } from '../../model/types';
import type { CiService, DevServerService, GitHubService, GitService, JiraService, WorkspaceService } from '../types';
import { toGhPullRequest, toGhReviewThreads, toJenkinsBuild, toJiraIssue, toUnifiedDiff } from './serialize';
import { delay, findBuild, findPr, findWorktree, ME, workItemByBranch, workItemOf, world } from './world';

const now = () => new Date().toISOString();
let seq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${++seq}`;

// ---- Jira ----------------------------------------------------------------------

const ticket = (key: string) => {
  const t = world.tickets.find((x) => x.key === key);
  if (!t) throw new Error(`acli: work item ${key} not found`);
  return t;
};

export const jira: JiraService = {
  async myOpenIssues() {
    await delay();
    return world.tickets.filter((t) => t.assignee === ME.name && t.status !== 'Done').map(toJiraIssue);
  },
  async getIssue(key) {
    await delay();
    return toJiraIssue(ticket(key));
  },
  async transition(key, status) {
    await delay();
    Object.assign(ticket(key), { status: status as TicketStatus, updatedAt: now() });
  },
  async addComment(key, body) {
    await delay();
    const t = ticket(key);
    t.comments = [...t.comments, { id: uid('c'), author: ME.name, at: now(), bodyMd: body }];
    t.updatedAt = now();
  },
};

// ---- CI ------------------------------------------------------------------------

/** A WorkItem for whoever owns this branch — the seed generators want one for context. */
function contextFor(repo: string, branch: string): WorkItem {
  const byBranch = workItemByBranch(repo, branch);
  if (byBranch) return byBranch;
  const pr = world.prs.find((p) => p.repo === repo && p.pr.sourceBranch === branch)?.pr;
  const ref = world.workspace.work.find((w) => w.repo === repo && pr && w.prNumber === pr.number);
  if (ref) return workItemOf(ref);
  return { id: branch, kind: 'adhoc', title: branch, repo, pr, pipeline: findBuild(repo, branch)?.pipeline, app: { status: 'stopped', logs: [] }, updatedAt: now() };
}

const buildRuns = new Map<string, number>();

/** Starts a new build and plays its stages through, one every couple of seconds. */
export function startBuild(repo: string, branch: string) {
  const key = `${repo}:${branch}`;
  const run = (buildRuns.get(key) ?? 0) + 1;
  buildRuns.set(key, run);

  const previous = findBuild(repo, branch);
  const pipeline = makeQueuedPipeline(contextFor(repo, branch), (previous?.pipeline.buildNumber ?? 0) + 1, ME.name);
  pipeline.branch = branch;
  if (previous) previous.pipeline = pipeline;
  else world.builds.push({ repo, pipeline });

  const setStage = (i: number, status: 'running' | 'passed') => {
    pipeline.stages = pipeline.stages.map((s, n) => (n === i ? { ...s, status } : s));
    pipeline.status = status === 'passed' && i === pipeline.stages.length - 1 ? 'passed' : 'running';
  };
  void (async () => {
    await delay(1200);
    for (let i = 0; i < pipeline.stages.length; i++) {
      if (buildRuns.get(key) !== run) return; // superseded by a newer build
      setStage(i, 'running');
      await delay(1600 + Math.random() * 1200);
      if (buildRuns.get(key) !== run) return;
      setStage(i, 'passed');
    }
  })();
}

export const ci: CiService = {
  async getBuild(repo, ref) {
    await delay();
    const build = findBuild(repo, ref.branch);
    return build && toJenkinsBuild(build.pipeline);
  },
  async trigger(repo, ref) {
    await delay();
    startBuild(repo, ref.branch);
  },
};

// ---- GitHub --------------------------------------------------------------------

function pull(repo: string, number: number): PullRequest {
  const found = findPr(repo, number);
  if (!found) throw new Error(`gh: pull request ${repo}#${number} not found`);
  return found.pr;
}

const touch = (pr: PullRequest) => {
  pr.updatedAt = now();
};

export const github: GitHubService = {
  async whoami() {
    await delay();
    return ME;
  },
  async findPullRequest(repo, branch) {
    await delay();
    return world.prs.find((p) => p.repo === repo && p.pr.sourceBranch === branch)?.pr.number;
  },
  async getPullRequest(repo, number) {
    await delay();
    return toGhPullRequest(repo, pull(repo, number));
  },
  async getDiff(repo, number) {
    await delay();
    return toUnifiedDiff(pull(repo, number).files);
  },
  async getReviewThreads(repo, number) {
    await delay();
    return toGhReviewThreads(pull(repo, number));
  },
  async createPullRequest(repo, { head, base, title, body, draft }) {
    await delay(1200);
    // the diff is whatever is on the branch — here: a generated, plausible change
    const pr: PullRequest = { ...makeDraftPr(contextFor(repo, head), ME.name), title, sourceBranch: head, targetBranch: base, state: draft ? 'draft' : 'open', updatedAt: now() };
    if (body) pr.descriptionMd = body;
    world.prs.push({ repo, pr });
    startBuild(repo, head); // opening a PR triggers CI, as the Jenkins webhook would
    return pr.number;
  },
  async markReady(repo, number) {
    await delay();
    const pr = pull(repo, number);
    pr.state = 'open';
    touch(pr);
  },
  async merge(repo, number) {
    await delay(1400);
    const pr = pull(repo, number);
    pr.state = 'merged';
    touch(pr);
  },
  async addReviewComment(repo, number, comment, pending) {
    await delay();
    const pr = pull(repo, number);
    const c = { id: uid('rc'), author: ME.name, at: now(), body: comment.body, pending: pending || undefined };
    if ('threadId' in comment) {
      pr.threads = pr.threads.map((t) => (t.id === comment.threadId ? { ...t, comments: [...t.comments, c] } : t));
    } else {
      pr.threads = [...pr.threads, { id: uid('rt'), filePath: comment.path, line: comment.line, side: comment.side === 'LEFT' ? 'old' : 'new', resolved: false, comments: [c] }];
    }
    touch(pr);
  },
  async deleteReviewComment(repo, number, commentId) {
    await delay();
    const pr = pull(repo, number);
    pr.threads = pr.threads.map((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== commentId) })).filter((t) => t.comments.length > 0);
    touch(pr);
  },
  async setThreadResolved(repo, number, threadId, resolved) {
    await delay();
    const pr = pull(repo, number);
    pr.threads = pr.threads.map((t) => (t.id === threadId ? { ...t, resolved } : t));
    touch(pr);
  },
  async submitReview(repo, number, event) {
    await delay(700);
    const pr = pull(repo, number);
    const mine = event === 'APPROVE' ? 'approved' : event === 'REQUEST_CHANGES' ? 'changes-requested' : 'commented';
    pr.reviewers = pr.reviewers.map((r) => (r.name === ME.name ? { ...r, state: mine } : r));
    if (event === 'APPROVE') pr.state = 'approved';
    if (event === 'REQUEST_CHANGES') pr.state = 'changes-requested';
    pr.threads = pr.threads.map((t) => ({ ...t, comments: t.comments.map((c) => ({ ...c, pending: undefined })) }));
    touch(pr);
  },
};

// ---- git -----------------------------------------------------------------------

export const git: GitService = {
  async listWorktrees(repo) {
    await delay();
    return world.worktrees.filter((w) => w.repo === repo).map((w) => ({ path: w.path, branch: w.branch, head: '0000000' }));
  },
  async addWorktree(repo, { path, branch, base }) {
    await delay(1200);
    world.worktrees.push({ repo, path, branch, baseBranch: base, ahead: 0, behind: 0, dirtyFiles: 0 });
    return { path, branch, head: '0000000' };
  },
  async status(path) {
    await delay();
    const w = findWorktree(path);
    if (!w) throw new Error(`git: ${path} is not a working tree`);
    return { ahead: w.ahead, behind: w.behind, dirtyFiles: w.dirtyFiles };
  },
  async rebase(path) {
    await delay(1100);
    const w = findWorktree(path);
    if (w) w.behind = 0;
  },
};

// ---- dev server ----------------------------------------------------------------

export const devServer: DevServerService = {
  async start(id, { repo, title }) {
    await delay();
    const port = 3000 + Math.floor(Math.random() * 900);
    world.devServers[id] = { status: 'starting', port, logs: [`$ npm run dev -- --port ${port}`, `> ${repo}@0.0.0 dev`] };
    const log = (line: string) => {
      const s = world.devServers[id];
      if (s && s.status !== 'stopped' && s.port === port) world.devServers[id] = { ...s, logs: [...s.logs, line] };
    };
    setTimeout(() => log('  resolving dependencies…'), 800);
    setTimeout(() => {
      const s = world.devServers[id];
      if (s?.status !== 'starting' || s.port !== port) return; // stopped or restarted meanwhile
      world.devServers[id] = {
        ...s,
        status: 'running',
        url: `/preview/index.html?work=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`,
        logs: [...s.logs, '  VITE ready in 388 ms', `  ➜  Local: http://localhost:${port}/`],
      };
    }, 2200);
  },
  async stop(id) {
    await delay();
    const s = world.devServers[id];
    if (s) world.devServers[id] = { status: 'stopped', logs: [...s.logs, '^C', 'process exited'] };
  },
  async get(id) {
    await delay(60);
    return world.devServers[id] ?? { status: 'stopped', logs: [] };
  },
};

// ---- workspace -----------------------------------------------------------------

export const workspace: WorkspaceService = {
  async load() {
    await delay();
    return structuredClone(world.workspace);
  },
  async save(next) {
    world.workspace = structuredClone(next);
  },
};
