/**
 * Dependency-free unified-diff statistics. Lives apart from the (lazy) DiffViewer so callers such as
 * worktree facts can use it without pulling diff2html into the main bundle.
 */

export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFileStat {
  path: string;
  /** previous path when `status === 'renamed'` */
  oldPath?: string;
  additions: number;
  deletions: number;
  status: DiffFileStatus;
  binary: boolean;
}

export interface DiffStats {
  files: DiffFileStat[];
  additions: number;
  deletions: number;
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

function stripPrefix(p: string, prefix: 'a/' | 'b/'): string {
  const unquoted = p.replace(/^"(.*)"$/, '$1').replace(/\t.*$/, '');
  return unquoted.startsWith(prefix) ? unquoted.slice(2) : unquoted;
}

function newFile(path: string): DiffFileStat {
  return { path, additions: 0, deletions: 0, status: 'modified', binary: false };
}

export function parseDiffStats(diff: string): DiffStats {
  const files: DiffFileStat[] = [];
  let cur: DiffFileStat | undefined;
  let sawHunk = false;
  let oldLeft = 0;
  let newLeft = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (cur && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      if (c === '+') {
        cur.additions++;
        newLeft--;
      } else if (c === '-') {
        cur.deletions++;
        oldLeft--;
      } else if (c !== '\\') {
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      cur = newFile((m ? m[2] : undefined) ?? line.slice(11));
      files.push(cur);
      sawHunk = false;
    } else if (line.startsWith('--- ')) {
      // plain (non-git) diffs have no "diff --git" header: a new "---" after hunks starts a new file
      if (!cur || sawHunk) {
        cur = newFile('');
        files.push(cur);
        sawHunk = false;
      }
      if (line.slice(4).startsWith('/dev/null')) cur.status = 'added';
      else cur.path ||= stripPrefix(line.slice(4), 'a/');
    } else if (cur && line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target.startsWith('/dev/null')) cur.status = 'deleted';
      else cur.path = stripPrefix(target, 'b/');
    } else if (cur && line.startsWith('new file mode')) cur.status = 'added';
    else if (cur && line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (cur && line.startsWith('rename from ')) {
      cur.status = 'renamed';
      cur.oldPath = line.slice(12);
    } else if (cur && line.startsWith('rename to ')) cur.path = line.slice(10);
    else if (cur && /^Binary files .* differ$|^GIT binary patch/.test(line)) cur.binary = true;
    else {
      const h = HUNK.exec(line);
      if (h && cur) {
        sawHunk = true;
        oldLeft = h[1] === undefined ? 1 : Number(h[1]);
        newLeft = h[2] === undefined ? 1 : Number(h[2]);
      }
    }
  }

  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { files, additions, deletions };
}
