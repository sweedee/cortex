/**
 * Pure helpers of the "new worktree" flow (project action, ticket action, "add to canvas" for
 * worktrees found on disk): branch names, paths and the arguments for `gitOps.worktreeAdd`.
 * Templates come from config.json (`git.branchTemplate`, `git.worktreesDir`); callers pass them.
 */
import { baseName as leafOf, isAbsolutePath, samePath, sepOf } from '../../../../shared/paths';
import { DEFAULT_USER_CONFIG, renderBranchTemplate } from '../../../../shared/userConfig';

/** "Retry with exponential backoff!" -> "retry-with-exponential-backoff" (max `max` chars, cut at a word). */
export function slugify(text: string, max = 40): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf('-');
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/-+$/, '');
}

/** A ticket's branch from config.json `git.branchTemplate` (`{key}`, `{slug}`; default `{key}-{slug}` → `CTX-12-retry`). */
export const branchForTicket = (key: string, title: string, template = DEFAULT_USER_CONFIG.git.branchTemplate) => renderBranchTemplate(template, { key, slug: slugify(title) });

/**
 * A project's worktrees folder from config.json `git.worktreesDir`: absolute, or relative to the base
 * checkout (`..` allowed); `{repo}` = `repo` (default: the checkout's folder name). Default
 * `../wt/{repo}`: `C:/code/app` → `C:/code/wt/app`.
 */
export function worktreesDirFor(baseDir: string, template = DEFAULT_USER_CONFIG.git.worktreesDir, repo = leafOf(baseDir)): string {
  const t = template.trim().split('{repo}').join(repo);
  const sep = sepOf(baseDir);
  if (isAbsolutePath(t)) return t.replace(/[\\/]+$/, '');
  const parts = baseDir.replace(/[\\/]+$/, '').split(/[\\/]/);
  for (const seg of t.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join(sep);
}

/** `<worktreesDir>/<branch>`; without a configured folder: config.json `git.worktreesDir` (default `wt/<name>` next to the base checkout). '' = nothing to go on. */
export function defaultWorktreePath(p: { baseDir?: string; worktreesDir?: string }, branch: string, template = DEFAULT_USER_CONFIG.git.worktreesDir): string {
  const name = branch.trim();
  if (!name) return '';
  const dir = p.worktreesDir?.trim();
  if (dir) return `${dir.replace(/[\\/]+$/, '')}${sepOf(dir)}${name}`;
  const base = p.baseDir?.trim();
  return base ? `${worktreesDirFor(base, template)}${sepOf(base)}${name}` : '';
}

/** The project can host worktrees: it has an absolute base checkout. */
export const hasBaseDir = (p: { baseDir?: string }) => !!p.baseDir && isAbsolutePath(p.baseDir);

export const SET_BASE_HINT = "Set the project's base checkout in Settings…";

export interface WorktreeForm {
  branch: string;
  base: string;
  path: string;
  newBranch: boolean;
}

export interface WorktreeAddArgs {
  repoDir: string;
  path: string;
  branch: string;
  base: string | undefined;
  newBranch: boolean;
}

/** Form values -> `gitOps.worktreeAdd` arguments. Throws a readable error for bad input. */
export function worktreeAddArgs(p: { baseDir?: string }, v: WorktreeForm): WorktreeAddArgs {
  if (!p.baseDir || !isAbsolutePath(p.baseDir)) throw new Error(SET_BASE_HINT);
  const branch = v.branch.trim();
  if (!branch) throw new Error('Branch name is required.');
  if (/\s|\.\.|[~^:?*[\\]|\.lock$|\/$|^-/.test(branch)) throw new Error(`"${branch}" is not a valid branch name.`);
  const path = v.path.trim();
  if (!path) throw new Error('Path is required.');
  if (!isAbsolutePath(path)) throw new Error('The worktree path must be absolute.');
  return { repoDir: p.baseDir, path, branch, base: v.base.trim() || undefined, newBranch: v.newBranch };
}

/** Unique `wt/<leaf>` handle for a worktree bubble. */
export function worktreeHandle(branch: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((h) => h.toLowerCase()));
  const leaf = branch.split('/').pop() || branch;
  const base = `wt/${leaf}`;
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`.toLowerCase())) return `${base}-${n}`;
}

/** Worktrees found by `git worktree list` that are not on the canvas yet (main checkout, bare and prunable entries excluded). */
export function untrackedWorktrees<W extends { path: string; bare: boolean; prunable: boolean }>(onDisk: W[], baseDir: string | undefined, onCanvasPaths: string[]): W[] {
  return onDisk.filter((w) => !w.bare && !w.prunable && !(baseDir && samePath(w.path, baseDir)) && !onCanvasPaths.some((c) => samePath(c, w.path)));
}
