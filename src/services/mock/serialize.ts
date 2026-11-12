/**
 * Mock world (domain shapes) → the formats the real tools print.
 * These are the inverse of src/services/mappers and exist only for the mocks.
 */
import type { DiffFile, Pipeline, PullRequest, SessionMessage, Ticket } from '../../model/types';
import { config } from '../config';
import type { ClaudeEvent, GhPullRequest, GhReviewThread, GhUser, JenkinsBuild, JenkinsStatus, JiraIssue } from '../types';

// ---- Jira ----------------------------------------------------------------------

export function toJiraIssue(t: Ticket): JiraIssue {
  const f = config.jira.fields;
  return {
    key: t.key,
    fields: {
      summary: t.summary,
      status: { name: t.status },
      issuetype: { name: t.type },
      priority: { name: t.priority },
      assignee: { displayName: t.assignee },
      reporter: { displayName: t.reporter },
      labels: t.labels,
      // plain markdown strings, as a wrapper / REST v2 would return; the mapper also accepts ADF
      description: t.descriptionMd,
      updated: t.updatedAt,
      parent: t.epic ? { key: `${t.key.split('-')[0]}-EPIC`, fields: { summary: t.epic } } : null,
      issuelinks: t.links.map((l) => ({
        type: { inward: l.relation, outward: l.relation },
        outwardIssue: { key: l.key, fields: { summary: l.summary } },
      })),
      comment: {
        comments: t.comments.map((c) => ({ id: c.id, author: { displayName: c.author }, created: c.at, body: c.bodyMd })),
      },
      [f.storyPoints]: t.storyPoints ?? null,
      [f.sprint]: t.sprint ? [{ name: t.sprint, state: 'active' }] : null,
      [f.acceptanceCriteria]: t.acceptanceCriteria.map((c) => `- ${c}`).join('\n'),
    },
  };
}

// ---- GitHub --------------------------------------------------------------------

export const toGhUser = (name: string): GhUser => ({ login: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name });

export function toGhPullRequest(repo: string, pr: PullRequest): GhPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state === 'merged' ? 'MERGED' : 'OPEN',
    isDraft: pr.state === 'draft',
    body: pr.descriptionMd,
    url: `https://github.com/${config.githubOwner}/${repo}/pull/${pr.number}`,
    author: toGhUser(pr.author),
    headRefName: pr.sourceBranch,
    baseRefName: pr.targetBranch,
    reviewDecision: pr.state === 'approved' || pr.state === 'merged' ? 'APPROVED' : pr.state === 'changes-requested' ? 'CHANGES_REQUESTED' : 'REVIEW_REQUIRED',
    reviewRequests: pr.reviewers.filter((r) => r.state === 'pending').map((r) => toGhUser(r.name)),
    latestReviews: pr.reviewers
      .filter((r) => r.state !== 'pending')
      .map((r) => ({
        author: toGhUser(r.name),
        state: r.state === 'approved' ? 'APPROVED' : r.state === 'changes-requested' ? 'CHANGES_REQUESTED' : 'COMMENTED',
      })),
    additions: pr.files.reduce((n, f) => n + f.additions, 0),
    deletions: pr.files.reduce((n, f) => n + f.deletions, 0),
    updatedAt: pr.updatedAt,
  };
}

/** Domain diff → unified diff text, like `gh pr diff` prints it. */
export function toUnifiedDiff(files: DiffFile[]): string {
  const out: string[] = [];
  for (const f of files) {
    out.push(`diff --git a/${f.path} b/${f.path}`);
    if (f.status === 'added') out.push('new file mode 100644');
    if (f.status === 'deleted') out.push('deleted file mode 100644');
    out.push(`--- ${f.status === 'added' ? '/dev/null' : `a/${f.path}`}`);
    out.push(`+++ ${f.status === 'deleted' ? '/dev/null' : `b/${f.path}`}`);
    for (const hunk of f.hunks) {
      out.push(hunk.header);
      for (const line of hunk.lines) out.push((line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.content);
    }
  }
  return out.join('\n') + '\n';
}

export function toGhReviewThreads(pr: PullRequest): GhReviewThread[] {
  return pr.threads.map((t) => ({
    id: t.id,
    isResolved: t.resolved,
    path: t.filePath,
    line: t.line,
    diffSide: t.side === 'old' ? 'LEFT' : 'RIGHT',
    comments: {
      nodes: t.comments.map((c) => ({
        id: c.id,
        author: toGhUser(c.author),
        body: c.body,
        createdAt: c.at,
        state: c.pending ? 'PENDING' : 'SUBMITTED',
      })),
    },
  }));
}

// ---- Jenkins -------------------------------------------------------------------

const STAGE_STATUS: Record<string, JenkinsStatus> = {
  passed: 'SUCCESS',
  failed: 'FAILED',
  running: 'IN_PROGRESS',
  queued: 'NOT_EXECUTED',
  skipped: 'NOT_EXECUTED',
};

export function toJenkinsBuild(p: Pipeline): JenkinsBuild {
  const building = p.status === 'running' || p.status === 'queued';
  return {
    job: p.job,
    number: p.buildNumber,
    url: `https://jenkins.ctx.example/job/${p.job.replace('/', '/job/')}/${p.buildNumber}/`,
    building,
    result: building ? null : p.status === 'passed' ? 'SUCCESS' : 'FAILURE',
    branch: p.branch,
    commit: p.commit,
    triggeredBy: p.triggeredBy,
    timestamp: Date.parse(p.startedAt),
    stages: p.stages.map((s, i) => ({
      id: String(10 + i * 6),
      name: s.name,
      status: STAGE_STATUS[s.status],
      durationMillis: s.status === 'queued' ? 0 : (s.durationSec ?? 0) * 1000,
      // a stage that has not started has no console output yet
      log: s.status === 'queued' ? undefined : s.log,
      tests: s.tests && s.status !== 'queued' ? { passCount: s.tests.passed, failCount: s.tests.failed, skipCount: s.tests.skipped } : undefined,
    })),
    history: p.history.map((h) => ({ number: h.buildNumber, result: h.status === 'passed' ? 'SUCCESS' : 'FAILURE', durationMillis: h.durationSec * 1000 })),
  };
}

// ---- Claude --------------------------------------------------------------------

/** Tool call arguments in the shape Claude Code's tools take them. */
function toolInput(tool: string, summary: string): Record<string, unknown> {
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return { file_path: summary };
    case 'Bash':
      return { command: summary };
    case 'Grep':
    case 'Glob':
      return { pattern: summary };
    default:
      return { description: summary };
  }
}

/** The tool_result text Claude Code gives back for an answered AskUserQuestion (verify the wording against real output). */
export function askResultContent(answers: Record<string, string | string[]>): string {
  const q = (s: string) => s.replace(/"/g, '\\"');
  const pairs = Object.entries(answers).map(([k, v]) => `"${q(k)}"="${q(Array.isArray(v) ? v.join(', ') : v)}"`);
  return `User has answered your questions: ${pairs.join(', ')}. You can now continue with the user's answers in mind.`;
}

/** One domain message → the stream-json event(s) that would have produced it. */
export function toClaudeEvents(sessionId: string, msg: SessionMessage, at?: string): ClaudeEvent[] {
  const base = { session_id: sessionId, timestamp: at };
  if (msg.role !== 'tool') {
    return msg.role === 'user'
      ? [{ ...base, type: 'user', message: { content: msg.text } }]
      : [{ ...base, type: 'assistant', message: { content: [{ type: 'text', text: msg.text }] } }];
  }
  const input = msg.questions ? { questions: msg.questions } : toolInput(msg.tool, msg.summary);
  const events: ClaudeEvent[] = [
    { ...base, type: 'assistant', message: { content: [{ type: 'tool_use', id: msg.id, name: msg.tool, input }] } },
  ];
  if (msg.status !== 'running') {
    const content = msg.questions ? (msg.answers ? askResultContent(msg.answers) : 'The user did not answer.') : (msg.detail ?? '');
    events.push({
      ...base,
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: msg.id, content, is_error: msg.status === 'error' || undefined }] },
    });
  }
  return events;
}
