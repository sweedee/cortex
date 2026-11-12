/** `gh` output → domain PullRequest. */
import type { DiffFile, DiffHunk, PrState, PullRequest, ReviewerState, ReviewThread } from '../../model/types';
import { config } from '../config';
import type { GhPullRequest, GhReviewThread, GhUser } from '../types';

/** GitHub only reliably gives logins; use the display name when it is there. */
export const displayName = (user: GhUser) => user.name || user.login;

/** The AI review bot (see config.aiReview). */
export const isAiBot = (user: GhUser) => user.login === config.aiReview.botLogin;

const LANGUAGES: Record<string, string> = { yml: 'yaml', mjs: 'js', cjs: 'js', kt: 'kotlin', py: 'python' };

function languageOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return LANGUAGES[ext] ?? ext;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses the output of `gh pr diff` / `git diff` (unified format) into files and hunks.
 * Hunk bodies are read by the line counts in their header, so content that happens to
 * look like a diff header (e.g. a removed line starting with "-- ") cannot confuse it.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = text.split('\n');
  let file: DiffFile | undefined;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const start = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (start) {
      file = { path: start[2], status: 'modified', language: languageOf(start[2]), additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      i++;
      continue;
    }
    if (file && file.hunks.length === 0) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from')) file.status = 'renamed';
    }

    const header = file && HUNK.exec(line);
    if (file && header) {
      let oldNo = Number(header[1]);
      let newNo = Number(header[3]);
      let oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      let newLeft = header[4] === undefined ? 1 : Number(header[4]);
      const hunk: DiffHunk = { header: line, lines: [] };
      i++;
      while (i < lines.length && (oldLeft > 0 || newLeft > 0)) {
        const body = lines[i++];
        const marker = body[0];
        const content = body.slice(1);
        if (marker === '+') {
          hunk.lines.push({ type: 'add', newNo: newNo++, content });
          file.additions++;
          newLeft--;
        } else if (marker === '-') {
          hunk.lines.push({ type: 'del', oldNo: oldNo++, content });
          file.deletions++;
          oldLeft--;
        } else if (marker === '\\') {
          // "\ No newline at end of file"
        } else {
          hunk.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, content });
          oldLeft--;
          newLeft--;
        }
      }
      file.hunks.push(hunk);
      continue;
    }
    i++;
  }
  return files;
}

function mapState(pr: GhPullRequest): PrState {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.isDraft) return 'draft';
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  // Note: the domain model has no "closed without merging" state yet; such PRs show as open.
  return 'open';
}

const REVIEW_STATE: Record<string, ReviewerState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  COMMENTED: 'commented',
};

export function mapReviewThread(thread: GhReviewThread): ReviewThread {
  return {
    id: thread.id,
    filePath: thread.path,
    // outdated threads have no line any more; 0 never matches a diff line, so the view lists them as outdated
    line: thread.line ?? 0,
    side: thread.diffSide === 'LEFT' ? 'old' : 'new',
    resolved: thread.isResolved,
    comments: thread.comments.nodes.map((c) => ({
      id: c.id,
      author: displayName(c.author),
      at: c.createdAt,
      body: c.body,
      pending: c.state === 'PENDING' || undefined,
    })),
  };
}

/** `me` is the display name of the signed-in GitHub user (see `whoami`). */
export function mapPullRequest(pr: GhPullRequest, diff: string, threads: GhReviewThread[], me: string): PullRequest {
  const author = displayName(pr.author);
  const requested = new Set(pr.reviewRequests.map(displayName));
  const bots = new Set([...pr.reviewRequests, ...pr.latestReviews.map((r) => r.author)].filter(isAiBot).map(displayName));
  const reviewers = [
    // somebody who reviewed and was then re-requested counts as pending again
    ...pr.latestReviews
      .filter((r) => !requested.has(displayName(r.author)))
      .map((r) => ({ name: displayName(r.author), state: REVIEW_STATE[r.state] ?? ('pending' as ReviewerState) })),
    ...[...requested].map((name) => ({ name, state: 'pending' as ReviewerState })),
  ].map((r) => (bots.has(r.name) ? { ...r, isBot: true } : r));
  return {
    number: pr.number,
    title: pr.title,
    state: mapState(pr),
    author,
    sourceBranch: pr.headRefName,
    targetBranch: pr.baseRefName,
    descriptionMd: pr.body,
    reviewers,
    files: parseUnifiedDiff(diff),
    threads: threads.map(mapReviewThread),
    updatedAt: pr.updatedAt,
    reviewRequested: (author !== me && reviewers.some((r) => r.name === me)) || undefined,
  };
}
