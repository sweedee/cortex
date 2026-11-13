/**
 * zod request schemas of the Phase 1 integration channels (spread into `schemas` in ./schemas.ts,
 * which also checks them against the contract at compile time).
 */
import { z } from 'zod';

// same rule as `absPath` in ./schemas.ts (not imported: schemas.ts imports this module)
const absPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), 'path must not contain NUL')
  .refine((p) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(p), 'path must be absolute');

const str = (max = 1000) => z.string().min(1).max(max).refine((s) => !s.includes('\0'), 'must not contain NUL');
/** refs, branch names, remotes: no leading `-` so they can never be read as an option */
const ref = str(500).refine((s) => !s.startsWith('-'), 'must not start with "-"');
const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/name');
const prNo = z.number().int().positive();
const text = z.string().max(65_536).refine((s) => !s.includes('\0'), 'must not contain NUL');
const env = z.record(z.string(), z.string()).optional();
const issueKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, 'expected an issue key like CTX-123');
const localId = str(200);

const diffReq = z.object({ dir: absPath, base: ref.optional(), staged: z.boolean().optional() });

export const integrationSchemas = {
  'integrations:config': z.undefined(),

  'git:isRepo': z.object({ dir: absPath }),
  'git:currentBranch': z.object({ dir: absPath }),
  'git:remoteRepo': z.object({ dir: absPath, remote: ref.optional() }),
  'git:worktreeList': z.object({ repoDir: absPath }),
  'git:worktreeAdd': z.object({ repoDir: absPath, path: absPath, branch: ref, base: ref.optional(), newBranch: z.boolean().optional() }),
  'git:worktreeRemove': z.object({ repoDir: absPath, path: absPath, force: z.boolean().optional() }),
  'git:status': z.object({ dir: absPath }),
  'git:diff': diffReq,
  'git:diffStat': diffReq,
  'git:log': z.object({ dir: absPath, range: ref.optional(), limit: z.number().int().positive().max(10_000).optional() }),
  'git:fetch': z.object({ dir: absPath, remote: ref.optional(), prune: z.boolean().optional() }),
  'git:rebase': z.object({ dir: absPath, onto: ref }),
  'git:rebaseAbort': z.object({ dir: absPath }),

  'gh:prList': z.object({
    repo,
    author: ref.optional(),
    app: ref.optional(),
    search: str().optional(),
    state: z.enum(['open', 'closed', 'merged', 'all']).optional(),
    label: ref.optional(),
    head: ref.optional(),
    base: ref.optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  'gh:prView': z.object({ repo, number: prNo }),
  'gh:prCreate': z.object({ dir: absPath, title: str(1000), body: text, base: ref, head: ref, draft: z.boolean().optional(), repo: repo.optional() }),
  'gh:prMerge': z.object({ repo, number: prNo, method: z.enum(['merge', 'squash', 'rebase']), deleteBranch: z.boolean().optional() }),
  'gh:prComment': z.object({ repo, number: prNo, body: text.min(1).optional() }),
  'gh:prUpdateBranch': z.object({ repo, number: prNo, rebase: z.boolean().optional() }),
  'gh:prDiff': z.object({ repo, number: prNo }),
  'gh:prChecks': z.object({ repo, number: prNo }),
  'gh:runView': z.object({ repo, runId: prNo }),
  'gh:runRerun': z.object({ repo, runId: prNo, failedOnly: z.boolean().optional() }),
  'gh:renovatePrs': z.object({ repo }),

  'jira:search': z.object({ jql: str(4000), limit: z.number().int().positive().max(1000).optional() }),
  'jira:view': z.object({ key: issueKey }),
  'jira:transition': z.object({ key: issueKey, status: str(200) }),
  'jira:create': z.object({ project: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), type: str(100), summary: str(1000), description: text.optional(), assignee: ref.optional(), parent: issueKey.optional() }),
  'jira:comment': z.object({ key: issueKey, body: text.min(1) }),
  'jira:edit': z.object({ key: issueKey, summary: str(1000).optional(), description: text.optional(), assignee: ref.optional(), labels: z.array(ref).optional() }),

  'claude:start': z.object({
    cwd: absPath,
    prompt: text.optional(),
    title: str(500).optional(),
    model: ref.optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    permissionMode: z.enum(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan', 'default']).optional(),
    resume: z.string().regex(/^[\w-]{1,200}$/).optional(),
    addDirs: z.array(absPath).max(50).optional(),
    appendSystemPrompt: text.optional(),
    localId: localId.optional(),
  }),
  'claude:send': z.object({ localId, text: text.min(1) }),
  'claude:answer': z.object({ localId, toolUseId: str(200), answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }),
  'claude:permission': z.object({
    localId,
    requestId: str(200),
    decision: z.discriminatedUnion('behavior', [
      z.object({ behavior: z.literal('allow'), updatedInput: z.record(z.string(), z.unknown()).optional() }),
      z.object({ behavior: z.literal('deny'), message: z.string().max(5000).optional() }),
    ]),
  }),
  'claude:interrupt': z.object({ localId }),
  'claude:stop': z.object({ localId }),
  'claude:remove': z.object({ localId }),
  'claude:list': z.undefined(),
  'claude:transcript': z.object({ localId }),
  'claude:session': z.object({ localId }),

  'apps:start': z.object({ id: str(200), cwd: absPath, command: str(8192), env, urlHint: z.string().url().optional() }),
  'apps:stop': z.object({ id: str(200) }),
  'apps:restart': z.object({ id: str(200) }),
  'apps:list': z.undefined(),
  'apps:log': z.object({ id: str(200) }),
  'apps:remove': z.object({ id: str(200) }),

  'tests:run': z.object({ id: str(200), cwd: absPath, command: str(8192), env }),
  'tests:stop': z.object({ id: str(200) }),
  'tests:list': z.undefined(),
  'tests:log': z.object({ id: str(200) }),
};
