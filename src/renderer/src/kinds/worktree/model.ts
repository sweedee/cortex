/** Pure helpers of the worktree kind: availability, defaults and argument building (unit-tested). */
import type { GitFileChange } from '../../../../shared/integrations/git';
import type { AppStartRequest, TestRunRequest } from '../../../../shared/integrations/runners';
import type { GhPrCreateRequest } from '../../../../shared/ipc';
import type { ItemOf } from '../../domain';

type Worktree = ItemOf<'worktree'>;
type Project = ItemOf<'project'>;
type Pr = ItemOf<'pr'>;

export const WORKTREE_HINT = "This worktree has no real checkout on disk (demo data). Create one from a project that has a base checkout (Settings), and it shows git data here.";

/** `C:\…`, `\\server\…` or `/…`: the main process only accepts absolute paths. */
export const isAbsolutePath = (p: string | undefined): p is string => !!p && /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(p);

/** Single-letter status for the changed-files list (M A D R U ?). */
export function statusLetter(f: Pick<GitFileChange, 'index' | 'worktree' | 'kind'>): string {
  if (f.kind === 'untracked') return '?';
  if (f.kind === 'unmerged') return 'U';
  if (f.kind === 'renamed') return 'R';
  const c = f.worktree !== '.' ? f.worktree : f.index;
  return c === '.' ? 'M' : c;
}

const humanize = (branch: string) =>
  branch
    .split('/')
    .pop()!
    .replace(/^[A-Z][A-Z0-9]+-\d+[-_]?/, '')
    .replace(/[-_]+/g, ' ')
    .trim();

/** Title for a new PR: "KEY: ticket summary", else the branch name made readable. */
export function defaultPrTitle(w: Worktree, ticket?: ItemOf<'ticket'>): string {
  if (ticket) return `${ticket.data.key}: ${ticket.title}`;
  const h = humanize(w.data.branch);
  const text = h ? h[0].toUpperCase() + h.slice(1) : w.data.branch;
  return w.data.ticketKey ? `${w.data.ticketKey}: ${text}` : text;
}

/** Body for a new PR: the linked ticket key with a link (`url` = `jiraUrl` from data/jira.ts). */
export function defaultPrBody(w: Worktree, ticket: ItemOf<'ticket'> | undefined, url: (key: string) => string): string {
  const key = ticket?.data.key ?? w.data.ticketKey;
  return key ? `Ticket: [${key}](${url(key)})\n\n` : '';
}

/** Open PRs of the project (candidates to stack on), excluding the worktree's own. */
export function stackCandidates(prs: Pr[], w: Worktree): Pr[] {
  return prs.filter((p) => p.data.state === 'open' && !p.archived && p.data.headBranch && p.data.headBranch !== w.data.branch);
}

export interface PrFormValues {
  title: string;
  body: string;
  base: string;
  draft: boolean;
  /** PR item id to stack on ('' = none) */
  stackOn: string;
}

/** The base branch actually used: the parent PR's head branch when stacking. */
export function prBase(v: PrFormValues, prs: Pr[]): string {
  const parent = prs.find((p) => p.id === v.stackOn);
  return parent ? parent.data.headBranch : v.base;
}

export function buildPrRequest(w: Worktree, project: Project, v: PrFormValues, prs: Pr[]): GhPrCreateRequest {
  return { dir: w.data.path, repo: project.data.repo, title: v.title.trim(), body: v.body, base: prBase(v, prs), head: w.data.branch, draft: v.draft || undefined };
}

const NO_CHECKOUT = 'No real checkout (demo data)';

/** Why "create PR" is not possible (undefined = available). */
export function prDisabled(w: Worktree, project: Project | undefined): string | undefined {
  if (!isAbsolutePath(w.data.path)) return NO_CHECKOUT;
  if (!project) return 'The worktree belongs to no project';
  if (!project.data.repo || project.data.repo.startsWith('unknown/')) return "Set the project's GitHub repo in its settings";
  return undefined;
}

export function launchDisabled(w: Worktree, project: Project | undefined): string | undefined {
  if (!isAbsolutePath(w.data.path)) return NO_CHECKOUT;
  if (!project?.data.startCommand) return 'Set a start command in the project settings';
  return undefined;
}

export function testsDisabled(w: Worktree, project: Project | undefined): string | undefined {
  if (!isAbsolutePath(w.data.path)) return NO_CHECKOUT;
  if (!project?.data.testCommand) return 'Set a test command in the project settings';
  return undefined;
}

export const pathDisabled = (w: Worktree): string | undefined => (isAbsolutePath(w.data.path) ? undefined : NO_CHECKOUT);

/** `git worktree remove` runs in the project's base checkout. Demo items are only archived. */
export function removeDisabled(w: Worktree, project: Project | undefined): string | undefined {
  if (!isAbsolutePath(w.data.path)) return undefined;
  if (!isAbsolutePath(project?.data.baseDir)) return "Set the project's base checkout in Settings";
  return undefined;
}

/** Runner requests for the app / test item of a worktree; the runner id is the item id. */
export const appRequest = (id: string, w: Worktree, command: string): AppStartRequest => ({ id, cwd: w.data.path, command });
export const testRequest = (id: string, w: Worktree, command: string): TestRunRequest => ({ id, cwd: w.data.path, command });
