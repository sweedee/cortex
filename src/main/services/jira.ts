/**
 * Jira via the Atlassian CLI surface `acli jira workitem …`. By default the command is the
 * bundled mock (`node scripts/jira-mock/jira-mock.mjs`); `CORTEX_JIRA_CLI=acli` switches to the
 * real CLI with the exact same arguments (see `config.ts`, `jiraCliSpec`).
 */
import type { JiraComment, JiraIssue } from '../../shared/integrations/jira';
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

  private acli(args: string[]) {
    // the mock runs as `<electron> <script> jira workitem …`: name it by what it does in errors
    return runOk(this.run, this.spec.command, this.argv(args), { cwd: this.cwd, env: this.spec.env }, `jira ${args.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ')}`.trim());
  }

  async search(jql: string, opts: { limit?: number; fields?: string[] } = {}): Promise<JiraIssue[]> {
    const args = ['search', '--jql', jql, '--json', ...(opts.limit ? ['--limit', String(opts.limit)] : []), ...(opts.fields ? ['--fields', opts.fields.join(',')] : [])];
    const out = await this.acli(args);
    const v = parseJson<JiraIssue[] | { issues: JiraIssue[] }>(out, 'jira search');
    return Array.isArray(v) ? v : (v.issues ?? []);
  }

  async view(key: string, opts: { fields?: string[] } = {}): Promise<JiraIssue> {
    return parseJson<JiraIssue>(await this.acli(['view', key, '--json', '--fields', (opts.fields ?? ['*all']).join(',')]), 'jira view');
  }

  async transition(key: string, status: string): Promise<void> {
    await this.acli(['transition', '--key', key, '--status', status, '--yes']);
  }

  async create(req: JiraCreateRequest): Promise<JiraIssue> {
    const args = ['create', '--project', req.project, '--type', req.type, '--summary', req.summary, '--json'];
    if (req.description) args.push('--description', req.description);
    if (req.assignee) args.push('--assignee', req.assignee);
    if (req.parent) args.push('--parent', req.parent);
    return parseJson<JiraIssue>(await this.acli(args), 'jira create');
  }

  async comment(key: string, body: string): Promise<JiraComment | null> {
    const out = await this.acli(['comment', 'create', '--key', key, '--body', body, '--json']);
    try {
      return JSON.parse(out) as JiraComment;
    } catch {
      return null; // real acli may print a plain confirmation
    }
  }

  async edit(req: JiraEditRequest): Promise<void> {
    const args = ['edit', '--key', req.key, '--yes'];
    if (req.summary !== undefined) args.push('--summary', req.summary);
    if (req.description !== undefined) args.push('--description', req.description);
    if (req.assignee !== undefined) args.push('--assignee', req.assignee);
    if (req.labels !== undefined) args.push('--labels', req.labels.join(','));
    await this.acli(args);
  }
}
