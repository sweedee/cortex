/**
 * Pure helpers of the "new worktree" flow (project action, ticket action, "add to canvas" for
 * worktrees found on disk): branch names, paths and the arguments for `gitOps.worktreeAdd`.
 */

export const isAbsolutePath = (p: string) => /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(p);
const sepOf = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const parentOf = (p: string) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '');
const leafOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/** Same folder? Ignores slash style, trailing slashes and (Windows drive paths) case. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[a-zA-Z]:/.test(s) ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
}

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

/** `<KEY>-<slug>` for a ticket. */
export const branchForTicket = (key: string, title: string) => [key, slugify(title)].filter(Boolean).join('-');

/** The Jira key a branch name mentions (`feat/CTX-12-x` -> `CTX-12`). */
export const ticketKeyOf = (branch: string): string | undefined => /[A-Z][A-Z0-9]+-\d+/.exec(branch)?.[0];

/** `<worktreesDir>/<branch>`; without a configured folder: `wt/<name>` next to the base checkout. '' = nothing to go on. */
export function defaultWorktreePath(p: { baseDir?: string; worktreesDir?: string }, branch: string): string {
  const name = branch.trim();
  if (!name) return '';
  const dir = p.worktreesDir?.trim();
  if (dir) return `${dir.replace(/[\\/]+$/, '')}${sepOf(dir)}${name}`;
  const base = p.baseDir?.trim();
  return base ? `${parentOf(base)}${sepOf(base)}wt${sepOf(base)}${leafOf(base)}${sepOf(base)}${name}` : '';
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
