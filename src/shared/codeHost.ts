/**
 * Code host abstraction: what the renderer needs from the service that hosts a project's repo,
 * its pull requests and its CI runs. Only GitHub (through `gh`) exists today; the renderer picks the
 * implementation with `codeHost(item.data.provider)` (`renderer/src/data/codehost.ts`).
 *
 * The data shapes are GitHub's (`./integrations/github`, aliased below). A second provider (GitLab,
 * Bitbucket, Gitea) maps its API into them, which works for PRs / checks / runs; fields without an
 * equivalent (e.g. `mergeStateStatus`) stay at their neutral values. Dependency free.
 */
import type { GhCheck, GhMergeMethod, GhPrListItem, GhPullRequest, GhRun, GhUpdateBranchResult } from './integrations/github';
import type { GhPrCreateRequest, GhPrEditRequest, GhPrListRequest } from './ipc';

/** Known code hosts; the optional `provider` field of project / pr / build data (absent = github). */
export const CODE_HOSTS = ['github'] as const;
export type CodeHostId = (typeof CODE_HOSTS)[number];
export const DEFAULT_CODE_HOST: CodeHostId = 'github';

export type CodeHostPr = GhPullRequest;
export type CodeHostPrListItem = GhPrListItem;
export type CodeHostCheck = GhCheck;
export type CodeHostRun = GhRun;
export type CodeHostMergeMethod = GhMergeMethod;
export type CodeHostPrFilter = Omit<GhPrListRequest, 'repo'>;

export interface CodeHost {
  id: CodeHostId;
  /** for UI copy: "Open on GitHub" */
  label: string;

  // ---- reads ----
  prList(repo: string, filter?: CodeHostPrFilter): Promise<CodeHostPrListItem[]>;
  prView(repo: string, number: number): Promise<CodeHostPr>;
  prDiff(repo: string, number: number): Promise<string>;
  prChecks(repo: string, number: number): Promise<CodeHostCheck[]>;
  /** dependency-update PRs (Renovate on GitHub) */
  dependencyPrs(repo: string): Promise<CodeHostPrListItem[]>;
  runView(repo: string, runId: number): Promise<CodeHostRun>;

  // ---- writes (each invalidates the cached reads it changes) ----
  prCreate(req: GhPrCreateRequest): Promise<{ number: number; url: string }>;
  prMerge(repo: string, number: number, method: CodeHostMergeMethod, opts?: { deleteBranch?: boolean }): Promise<void>;
  prComment(repo: string, number: number, body: string): Promise<{ url?: string }>;
  /** the configured AI-review trigger comment */
  requestAiReview(repo: string, number: number): Promise<{ url?: string }>;
  prUpdateBranch(repo: string, number: number, opts?: { rebase?: boolean }): Promise<GhUpdateBranchResult>;
  /** retarget (`base`) and / or change title / body */
  prEdit(req: GhPrEditRequest): Promise<void>;
  runRerun(repo: string, runId: number, opts?: { failedOnly?: boolean }): Promise<void>;

  // ---- links ----
  /** web URL of a repo (or a path below it: `/pull/3`) */
  repoUrl(repo: string, path?: string): string;
  prUrl(repo: string, number: number): string;
  runUrl(repo: string, runId: number | string): string;
}
