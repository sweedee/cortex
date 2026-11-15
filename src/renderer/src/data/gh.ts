/**
 * GitHub (`native.gh.*`), the `CodeHost` implementation for `provider: 'github'`. Use it through
 * `codeHost(provider)` / the hooks in `./codehost.ts`, not directly.
 */
import type { CodeHost } from '../../../shared/codeHost';
import { native } from '../native';
import { getState } from '../store';
import { repoWebUrl } from './config';
import { invalidate } from './ops';
import { qk } from './queryKeys';

export const github: CodeHost = {
  id: 'github',
  label: 'GitHub',

  prList: (repo, filter = {}) => native.gh.prList({ ...filter, repo }),
  prView: (repo, number) => native.gh.prView({ repo, number }),
  prDiff: (repo, number) => native.gh.prDiff({ repo, number }),
  prChecks: (repo, number) => native.gh.prChecks({ repo, number }),
  dependencyPrs: (repo) => native.gh.renovatePrs({ repo }),
  runView: (repo, runId) => native.gh.runView({ repo, runId }),

  async prCreate(req) {
    const r = await native.gh.prCreate(req);
    await invalidate(req.repo ? qk.gh.prs(req.repo) : qk.gh.all);
    return r;
  },
  async prMerge(repo, number, method, opts) {
    await native.gh.prMerge({ repo, number, method, deleteBranch: opts?.deleteBranch });
    await invalidate(qk.gh.pr(repo, number), qk.gh.prs(repo));
  },
  async prComment(repo, number, body) {
    const r = await native.gh.prComment({ repo, number, body });
    await invalidate(qk.gh.pr(repo, number));
    return r;
  },
  /** config.json `github.aiReviewComment` */
  requestAiReview: (repo, number) => github.prComment(repo, number, getState().settings.aiReviewComment),
  async prUpdateBranch(repo, number, opts) {
    const r = await native.gh.prUpdateBranch({ repo, number, rebase: opts?.rebase });
    await invalidate(qk.gh.pr(repo, number));
    return r;
  },
  async prEdit(req) {
    await native.gh.prEdit(req);
    await invalidate(qk.gh.pr(req.repo, req.number), qk.gh.prs(req.repo));
  },
  async runRerun(repo, runId, opts) {
    await native.gh.runRerun({ repo, runId, failedOnly: opts?.failedOnly });
    await invalidate(qk.gh.run(repo, runId));
  },

  // config.json `github.host` (GitHub Enterprise)
  repoUrl: (repo, path) => repoWebUrl(repo, path),
  prUrl: (repo, number) => repoWebUrl(repo, `/pull/${number}`),
  runUrl: (repo, runId) => repoWebUrl(repo, `/actions/runs/${runId}`),
};
