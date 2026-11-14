/**
 * Jira via the Atlassian CLI `acli jira workitem …` (default), or the bundled mock with the same
 * surface (`node scripts/jira-mock/jira-mock.mjs`, `CORTEX_JIRA_CLI=mock`; see `config.ts`).
 *
 * Verified against acli 1.3.40 (captured output in `__fixtures__/acli/`):
 * - `view <KEY> --json --fields *all` and `create … --json` print REST v3 issue JSON; `self` URLs point
 *   at Atlassian's API gateway (`*.atl-paas.net`), not the site → links use `auth status`'s site.
 * - `search --json` prints an array; `--fields` only accepts a few fields (key, summary, status,
 *   issuetype, assignee, priority, labels, description, reporter), so the default set is used.
 * - `transition`, `edit`, `comment create` with `--json` print `{results: [{status, message, id}]}` and
 *   exit 0 even on FAILURE → the results are checked here. `comment create` returns no comment.
 * - status names are the site's (localized) names, e.g. "In Arbeit"; acli has no "list transitions",
 *   so `statuses()` collects the statuses used in the project.
 */
import { bulkFailures, isAcliBulkResult, parseAcliSite, workflowStatuses, type JiraComment, type JiraIssue, type JiraStatusOption } from '../../shared/integrations/jira';
import { defaultRunner, parseJson, runOk, type Runner } from './cli';
import type { JiraCliSpec } from './config';

export interface JiraCreateRequest {
  project: string;
  type: string;
  summary: string;
  description?: string;
  assignee?: string;
  parent?: string;
}

export interface JiraEditRequest {
  key: string;
  summary?: string;
  description?: string;
  assignee?: string;
  labels?: string[];
}

export class JiraService {
  private spec: JiraCliSpec;
  private run: Runner;
  private cwd: string;
  constructor(spec: JiraCliSpec, opts: { run?: Runner; cwd?: string } = {}) {
    this.spec = spec;
    this.run = opts.run ?? defaultRunner;
    this.cwd = opts.cwd ?? process.cwd();
  }

  /** switch the CLI (acli missing → mock) */
  setSpec(spec: JiraCliSpec) {
    this.spec = spec;
  }

  /** argv after the command for `jira workitem <args>` (used for `exec:run` with cmd `jira-mock` too) */
  argv(args: string[]): string[] {
    return [...this.spec.prefix, 'jira', 'workitem', ...args];
  }

  get command() {
    return this.spec.command;
  }

  /** args before `jira workitem …` (the mock's script path; empty for acli) */
  get prefix() {
    return this.spec.prefix;
  }

  get env() {
    return this.spec.env;
  }

  private label(args: string[]) {
    // the mock runs as `<electron> <script> jira workitem …`: name it by what it does in errors
    return `jira ${args.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ')}`.trim();
  }

  private acli(args: string[]) {
    return runOk(this.run, this.spec.command, this.argv(args), { cwd: this.cwd, env: this.spec.env }, this.label(args));
  }

  /** A bulk command with `--json`: throws with acli's message when a work item failed (acli exits 0 then). */
  private async bulk(args: string[]): Promise<unknown> {
    const out = await this.acli(args);
    let v: unknown;
    try {
      v = JSON.parse(out);
    } catch {
      if (/^\s*✗/m.test(out)) throw new Error(`jira ${args[0]}: ${out.trim().replace(/^✗\s*(Failure|Error):\s*/i, '')}`);
      return null;
    }
    if (isAcliBulkResult(v)) {
      const failed = bulkFailures(v);
      if (failed.length) throw new Error(`jira ${args[0]}: ${failed.join('; ')}`);
    }
    return v;
  }

  /**
   * The Jira site (`https://acme.atlassian.net`) from `acli jira auth status`; null when acli is not
   * logged in. Rejects when the CLI cannot be started (not installed).
   */
  async site(): Promise<string | null> {
    const r = await this.run(this.spec.command, [...this.spec.prefix, 'jira', 'auth', 'status'], { cwd: this.cwd, env: this.spec.env, timeoutMs: 15_000 });
    return parseAcliSite(r.stdout);
  }

  async search(jql: string, opts: { limit?: number; fields?: string[]; all?: boolean } = {}): Promise<JiraIssue[]> {
    const args = ['search', '--jql', jql, '--json'];
    if (opts.all) args.push('--paginate');
    else if (opts.limit) args.push('--limit', String(opts.limit));
    if (opts.fields) args.push('--fields', opts.fields.join(','));
    const out = await this.acli(args);
    if (!out.trim().startsWith('[') && !out.trim().startsWith('{')) return []; // "No work items found."
    const v = parseJson<JiraIssue[] | { issues: JiraIssue[] }>(out, 'jira search');
    return Array.isArray(v) ? v : (v.issues ?? []);
  }

  async view(key: string, opts: { fields?: string[] } = {}): Promise<JiraIssue> {
    return parseJson<JiraIssue>(await this.acli(['view', key, '--json', '--fields', (opts.fields ?? ['*all']).join(',')]), 'jira view');
  }

  /** The statuses of a project's workflow as far as its issues show them (see the file comment). */
  async statuses(project: string): Promise<JiraStatusOption[]> {
    const issues = await this.search(`project = "${project.replace(/"/g, '')}"`, { fields: ['key', 'status'], all: true });
    return workflowStatuses(issues);
  }

  async transition(key: string, status: string): Promise<void> {
    await this.bulk(['transition', '--key', key, '--status', status, '--yes', '--json']);
  }

  async create(req: JiraCreateRequest): Promise<JiraIssue> {
    const args = ['create', '--project', req.project, '--type', req.type, '--summary', req.summary, '--json'];
    if (req.description) args.push('--description', req.description);
    if (req.assignee) args.push('--assignee', req.assignee);
    if (req.parent) args.push('--parent', req.parent);
    return parseJson<JiraIssue>(await this.acli(args), 'jira create');
  }

  /** acli prints only a bulk result (no comment object): null then; the mock prints the comment. */
  async comment(key: string, body: string): Promise<JiraComment | null> {
    const v = await this.bulk(['comment', 'create', '--key', key, '--body', body, '--json']);
    return v && typeof v === 'object' && 'body' in v && 'id' in v ? (v as JiraComment) : null;
  }

  async edit(req: JiraEditRequest): Promise<void> {
    const args = ['edit', '--key', req.key, '--yes', '--json'];
    if (req.summary !== undefined) args.push('--summary', req.summary);
    if (req.description !== undefined) args.push('--description', req.description);
    if (req.assignee !== undefined) args.push('--assignee', req.assignee);
    if (req.labels !== undefined) args.push('--labels', req.labels.join(','));
    await this.bulk(args);
  }
}
