/**
 * Git integration types (dependency free, shared by the server and the renderer) plus the pure
 * parsers for git's machine-readable output. The server runs the commands (`src/server/services/git.ts`).
 */

/** One entry of `git worktree list --porcelain`. */
export interface GitWorktree {
  /** absolute path, as git prints it (forward slashes on Windows) */
  path: string;
  /** commit sha of HEAD; empty for a bare repo */
  head: string;
  /** short branch name (`refs/heads/` stripped); null when detached or bare */
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Two-letter status of a changed file (porcelain v2 `XY`, `.` = unchanged). */
export interface GitFileChange {
  path: string;
  /** set for renames / copies */
  origPath?: string;
  /** index (staged) status: `.` M A D R C U */
  index: string;
  /** working tree status: `.` M A D R C U */
  worktree: string;
  kind: 'changed' | 'renamed' | 'unmerged' | 'untracked' | 'ignored';
}

/** `git status --porcelain=v2 --branch -z` */
export interface GitStatus {
  /** null when detached */
  branch: string | null;
  /** HEAD sha; null on an unborn branch */
  head: string | null;
  upstream: string | null;
  /** commits ahead / behind the upstream; 0 without an upstream */
  ahead: number;
  behind: number;
  files: GitFileChange[];
  /** any change at all (untracked included, ignored excluded) */
  dirty: boolean;
  /** a rebase is in progress (`.git/rebase-merge` or `rebase-apply` exists) */
  rebasing?: boolean;
}

export interface GitDiffStatFile {
  path: string;
  /** null for binary files */
  additions: number | null;
  deletions: number | null;
}

/** `git diff --numstat` */
export interface GitDiffStat {
  files: GitDiffStatFile[];
  additions: number;
  deletions: number;
}

export interface GitLogEntry {
  sha: string;
  short: string;
  author: string;
  email: string;
  /** ISO 8601 author date */
  date: string;
  subject: string;
}

export type GitRebaseResult = { ok: true } | { ok: false; conflicts: string[] };

// ---- parsers ------------------------------------------------------------------------

export function parseWorktreeList(out: string): GitWorktree[] {
  const list: GitWorktree[] = [];
  for (const block of out.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines[0]?.startsWith('worktree ')) continue;
    const wt: GitWorktree = { path: lines[0].slice(9), head: '', branch: null, bare: false, detached: false, locked: false, prunable: false };
    for (const l of lines.slice(1)) {
      if (l.startsWith('HEAD ')) wt.head = l.slice(5);
      else if (l.startsWith('branch ')) wt.branch = l.slice(7).replace(/^refs\/heads\//, '');
      else if (l === 'bare') wt.bare = true;
      else if (l === 'detached') wt.detached = true;
      else if (l === 'locked' || l.startsWith('locked ')) wt.locked = true;
      else if (l === 'prunable' || l.startsWith('prunable ')) wt.prunable = true;
    }
    list.push(wt);
  }
  return list;
}

/** Parses `git status --porcelain=v2 --branch -z` (NUL separated). */
export function parseStatusV2(out: string): GitStatus {
  const s: GitStatus = { branch: null, head: null, upstream: null, ahead: 0, behind: 0, files: [], dirty: false };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('# ')) {
      const [, key, ...rest] = p.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.oid') s.head = val === '(initial)' ? null : val;
      else if (key === 'branch.head') s.branch = val === '(detached)' ? null : val;
      else if (key === 'branch.upstream') s.upstream = val;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(val);
        if (m) {
          s.ahead = Number(m[1]);
          s.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = p[0];
    if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const f = p.split(' ');
      s.files.push({ path: f.slice(8).join(' '), index: f[1]?.[0] ?? ' ', worktree: f[1]?.[1] ?? ' ', kind: 'changed' });
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = p.split(' ');
      s.files.push({ path: f.slice(9).join(' '), origPath: parts[++i], index: f[1]?.[0] ?? ' ', worktree: f[1]?.[1] ?? ' ', kind: 'renamed' });
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = p.split(' ');
      s.files.push({ path: f.slice(10).join(' '), index: f[1]?.[0] ?? ' ', worktree: f[1]?.[1] ?? ' ', kind: 'unmerged' });
    } else if (type === '?') {
      s.files.push({ path: p.slice(2), index: '?', worktree: '?', kind: 'untracked' });
    } else if (type === '!') {
      s.files.push({ path: p.slice(2), index: '!', worktree: '!', kind: 'ignored' });
    }
  }
  s.dirty = s.files.some((f) => f.kind !== 'ignored');
  return s;
}

/** Parses `git diff --numstat -z`. */
export function parseNumstat(out: string): GitDiffStat {
  const files: GitDiffStatFile[] = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = (parts[i] ?? '').replace(/^\n/, '');
    if (!p) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(p);
    if (!m) continue;
    let path = m[3] ?? '';
    // renames with -z: "a\td\t" then old path, new path as separate entries
    if (path === '') {
      i += 2;
      path = parts[i] ?? '';
    }
    files.push({ path, additions: m[1] === '-' ? null : Number(m[1]), deletions: m[2] === '-' ? null : Number(m[2]) });
  }
  return {
    files,
    additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  };
}

/** `git log` format used by the service: fields separated by \x1f, records by \x1e. */
export const GIT_LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e';

export function parseLog(out: string): GitLogEntry[] {
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((r) => {
      const [sha, short, author, email, date, subject] = r.split('\x1f');
      return { sha: sha ?? '', short: short ?? '', author: author ?? '', email: email ?? '', date: date ?? '', subject: subject ?? '' };
    });
}

/**
 * `owner/name` from a GitHub remote URL (https, ssh, scp-like); null for anything else.
 * Any host is accepted (GitHub Enterprise too) unless `host` is given: then the remote must be on it.
 */
export function parseRemoteRepo(url: string, host?: string): string | null {
  const u = url.trim();
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u) ?? /^(?:[^@]+@)?([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u);
  if (!m) return null;
  // `host` (config github.host): a remote on another host is not a repo of this GitHub
  if (host && (m[1] ?? '').toLowerCase() !== (host.split(':')[0] ?? '').toLowerCase()) return null;
  return `${m[2]}/${m[3]}`;
}
