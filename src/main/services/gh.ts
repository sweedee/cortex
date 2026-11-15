/** Real `gh` CLI. Returns tool-shaped JSON; compact mappers live in `shared/integrations/github.ts`. */
import type { IntegrationConfig } from '../../shared/integrations/config';
import {
  GH_CHECK_FIELDS,
  GH_PR_FIELDS,
  GH_PR_LIST_FIELDS,
  GH_RUN_FIELDS,
  isConflictMessage,
  prNumberFromUrl,
  type GhCheck,
  type GhMergeMethod,
  type GhPrListItem,
  type GhPullRequest,
  type GhRun,
  type GhUpdateBranchResult,
} from '../../shared/integrations/github';
import type { GhPrEditRequest } from '../../shared/ipc';
import { ghChecksSchema, ghPrListSchema, ghPullRequestSchema, ghRunSchema } from './schemas';
import { CliError, defaultRunner, parseJson, runOk, type Runner } from './cli';

export interface PrListFilter {
  /** login, `@me`, or for GitHub Apps use `app` */
  author?: string;
  /** GitHub App slug (`gh pr list --app renovate`) */
  app?: string;
  /** GitHub search syntax (`--search`) */
  search?: string;
  state?: 'open' | 'closed' | 'merged' | 'all';
  label?: string;
  head?: string;
  base?: string;
  limit?: number;
}

export interface PrCreateRequest {
  title: string;
  body: string;
  /** may be another PR's head branch (stacked PR) */
  base: string;
  head: string;
  draft?: boolean;
  /** owner/name; default: the repo of `dir` */
  repo?: string;
}

/** gh never prompts when it has no TTY, but make sure */
const ENV = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };

export class GhService {
  private run: Runner;
  private cfg: IntegrationConfig['github'];
  /** gh needs some cwd; repo-scoped calls pass --repo so any directory works */
  private cwd: string;
  constructor(cfg: IntegrationConfig['github'], opts: { run?: Runner; cwd?: string } = {}) {
    this.cfg = cfg;
    this.run = opts.run ?? defaultRunner;
    this.cwd = opts.cwd ?? process.cwd();
  }

  private gh(args: string[], cwd = this.cwd) {
    return runOk(this.run, 'gh', args, { cwd, env: ENV });
  }

  async prList(repo: string, f: PrListFilter = {}): Promise<GhPrListItem[]> {
    const args = ['pr', 'list', '--repo', repo, '--state', f.state ?? 'open', '--limit', String(f.limit ?? 50), '--json', GH_PR_LIST_FIELDS];
    if (f.author) args.push('--author', f.author);
    if (f.app) args.push('--app', f.app);
    if (f.search) args.push('--search', f.search);
    if (f.label) args.push('--label', f.label);
    if (f.head) args.push('--head', f.head);
    if (f.base) args.push('--base', f.base);
    return parseJson<GhPrListItem[]>(await this.gh(args), 'gh pr list', ghPrListSchema);
  }

  async prView(repo: string, number: number): Promise<GhPullRequest> {
    return parseJson<GhPullRequest>(await this.gh(['pr', 'view', String(number), '--repo', repo, '--json', GH_PR_FIELDS]), 'gh pr view', ghPullRequestSchema);
  }

  /** runs in `dir` (the worktree); the head branch must already be pushed */
  async prCreate(dir: string, pr: PrCreateRequest): Promise<{ number: number; url: string }> {
    const args = ['pr', 'create', '--title', pr.title, '--body', pr.body, '--base', pr.base, '--head', pr.head];
    if (pr.draft) args.push('--draft');
    if (pr.repo) args.push('--repo', pr.repo);
    const out = await this.gh(args, dir);
    const hit = prNumberFromUrl(out);
    if (!hit) throw new Error(`gh pr create: no PR URL in output: ${out.slice(0, 300)}`);
    return hit;
  }

  async prMerge(repo: string, number: number, method: GhMergeMethod, opts: { deleteBranch?: boolean } = {}): Promise<void> {
    await this.gh(['pr', 'merge', String(number), '--repo', repo, `--${method}`, ...(opts.deleteBranch ? ['--delete-branch'] : [])]);
  }

  /** without a body: the configured AI-review trigger comment */
  async prComment(repo: string, number: number, body?: string): Promise<{ url?: string }> {
    const out = await this.gh(['pr', 'comment', String(number), '--repo', repo, '--body', body ?? this.cfg.aiReviewComment]);
    const url = /https?:\/\/\S+/.exec(out)?.[0];
    return url ? { url } : {};
  }

  /** `gh pr update-branch --rebase`; conflicts come back as a result, other failures throw */
  async prUpdateBranch(repo: string, number: number, opts: { rebase?: boolean } = {}): Promise<GhUpdateBranchResult> {
    const args = ['pr', 'update-branch', String(number), '--repo', repo, ...(opts.rebase === false ? [] : ['--rebase'])];
    const r = await this.run('gh', args, { cwd: this.cwd, env: ENV });
    const message = (r.stderr + r.stdout).trim();
    if (r.code === 0) return { ok: true, message };
    if (isConflictMessage(message)) return { ok: false, conflicts: true, message };
    throw new CliError('gh', args, r);
  }

  /** `gh pr edit`: change the base branch (retarget a stacked PR), title and / or body */
  async prEdit(req: GhPrEditRequest): Promise<void> {
    const args = ['pr', 'edit', String(req.number), '--repo', req.repo];
    if (req.base !== undefined) args.push('--base', req.base);
    if (req.title !== undefined) args.push('--title', req.title);
    if (req.body !== undefined) args.push('--body', req.body);
    await this.gh(args);
  }

  prDiff(repo: string, number: number): Promise<string> {
    return this.gh(['pr', 'diff', String(number), '--repo', repo, '--color', 'never']);
  }

  /** `gh pr checks` exits 8 while checks are pending and 1 when some failed: both still print JSON */
  async prChecks(repo: string, number: number): Promise<GhCheck[]> {
    const args = ['pr', 'checks', String(number), '--repo', repo, '--json', GH_CHECK_FIELDS];
    const r = await this.run('gh', args, { cwd: this.cwd, env: ENV });
    const out = r.stdout.trim();
    if (out.startsWith('[')) return parseJson<GhCheck[]>(out, 'gh pr checks', ghChecksSchema);
    // "no checks reported on the '<branch>' branch"
    if (/no checks reported/i.test(r.stderr + r.stdout)) return [];
    throw new CliError('gh', args, r);
  }

  async runView(repo: string, runId: number): Promise<GhRun> {
    return parseJson<GhRun>(await this.gh(['run', 'view', String(runId), '--repo', repo, '--json', GH_RUN_FIELDS]), 'gh run view', ghRunSchema);
  }

  async runRerun(repo: string, runId: number, opts: { failedOnly?: boolean } = {}): Promise<void> {
    await this.gh(['run', 'rerun', String(runId), '--repo', repo, ...(opts.failedOnly ? ['--failed'] : [])]);
  }

  /** open Renovate PRs: authored by the Renovate app, plus any carrying the renovate label */
  async renovatePrs(repo: string): Promise<GhPrListItem[]> {
    const [byApp, byLabel] = await Promise.all([
      this.prList(repo, { app: this.cfg.renovateApp }),
      this.prList(repo, { label: this.cfg.renovateLabel }).catch(() => [] as GhPrListItem[]), // unknown label → error; ignore
    ]);
    const seen = new Set<number>();
    return [...byApp, ...byLabel].filter((p) => !seen.has(p.number) && seen.add(p.number));
  }
}
