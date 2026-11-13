/**
 * Phase 1 part of the bridge: forwards the integration channels. Bundled into the sandboxed
 * preload, so it may only use the `invoke` / `on` helpers it is given (no imports but types).
 */
import type { CortexApi, EventChannel, EventChannels, InvokeChannel, Req, Res, Unsubscribe } from '../shared/ipc';

type Invoke = <C extends InvokeChannel>(channel: C, req?: Req<C>) => Promise<Res<C>>;
type On = <C extends EventChannel>(channel: C, cb: (payload: EventChannels[C]) => void) => Unsubscribe;

export function integrationsApi(invoke: Invoke, on: On, eventChannels: readonly string[]): Pick<CortexApi, 'integrations' | 'git' | 'gh' | 'jira' | 'claude' | 'apps' | 'tests' | 'on'> {
  return {
    integrations: { config: () => invoke('integrations:config') },
    git: {
      isRepo: (dir) => invoke('git:isRepo', { dir }),
      currentBranch: (dir) => invoke('git:currentBranch', { dir }),
      remoteRepo: (dir, remote) => invoke('git:remoteRepo', { dir, remote }),
      worktreeList: (repoDir) => invoke('git:worktreeList', { repoDir }),
      worktreeAdd: (repoDir, path, branch, base, opts = {}) => invoke('git:worktreeAdd', { repoDir, path, branch, base, newBranch: opts.newBranch }),
      worktreeRemove: (repoDir, path, opts = {}) => invoke('git:worktreeRemove', { repoDir, path, force: opts.force }),
      status: (dir) => invoke('git:status', { dir }),
      diff: (dir, opts = {}) => invoke('git:diff', { dir, ...opts }),
      diffStat: (dir, opts = {}) => invoke('git:diffStat', { dir, ...opts }),
      log: (dir, opts = {}) => invoke('git:log', { dir, ...opts }),
      fetch: (dir, opts = {}) => invoke('git:fetch', { dir, ...opts }),
      rebase: (dir, onto) => invoke('git:rebase', { dir, onto }),
      rebaseAbort: (dir) => invoke('git:rebaseAbort', { dir }),
    },
    gh: {
      prList: (repo, filter = {}) => invoke('gh:prList', { repo, ...filter }),
      prView: (repo, number) => invoke('gh:prView', { repo, number }),
      prCreate: (req) => invoke('gh:prCreate', req),
      prMerge: (repo, number, method, opts = {}) => invoke('gh:prMerge', { repo, number, method, deleteBranch: opts.deleteBranch }),
      prComment: (repo, number, body) => invoke('gh:prComment', { repo, number, body }),
      prUpdateBranch: (repo, number, opts = {}) => invoke('gh:prUpdateBranch', { repo, number, rebase: opts.rebase }),
      prDiff: (repo, number) => invoke('gh:prDiff', { repo, number }),
      prChecks: (repo, number) => invoke('gh:prChecks', { repo, number }),
      runView: (repo, runId) => invoke('gh:runView', { repo, runId }),
      runRerun: (repo, runId, opts = {}) => invoke('gh:runRerun', { repo, runId, failedOnly: opts.failedOnly }),
      renovatePrs: (repo) => invoke('gh:renovatePrs', { repo }),
    },
    jira: {
      search: (jql, opts = {}) => invoke('jira:search', { jql, limit: opts.limit }),
      view: (key) => invoke('jira:view', { key }),
      transition: (key, status) => invoke('jira:transition', { key, status }),
      create: (req) => invoke('jira:create', req),
      comment: (key, body) => invoke('jira:comment', { key, body }),
      edit: (req) => invoke('jira:edit', req),
    },
    claude: {
      start: (req) => invoke('claude:start', req),
      send: (localId, text) => invoke('claude:send', { localId, text }),
      answer: (localId, toolUseId, answers) => invoke('claude:answer', { localId, toolUseId, answers }),
      permission: (localId, requestId, decision) => invoke('claude:permission', { localId, requestId, decision }),
      interrupt: (localId) => invoke('claude:interrupt', { localId }),
      stop: (localId) => invoke('claude:stop', { localId }),
      remove: (localId) => invoke('claude:remove', { localId }),
      list: () => invoke('claude:list'),
      transcript: (localId) => invoke('claude:transcript', { localId }),
      session: (localId) => invoke('claude:session', { localId }),
    },
    apps: {
      start: (req) => invoke('apps:start', req),
      stop: (id) => invoke('apps:stop', { id }),
      restart: (id) => invoke('apps:restart', { id }),
      list: () => invoke('apps:list'),
      log: (id) => invoke('apps:log', { id }),
      remove: (id) => invoke('apps:remove', { id }),
    },
    tests: {
      run: (req) => invoke('tests:run', req),
      stop: (id) => invoke('tests:stop', { id }),
      list: () => invoke('tests:list'),
      log: (id) => invoke('tests:log', { id }),
    },
    on: (channel, cb) => {
      // only declared event channels: the renderer can't listen to arbitrary ipc traffic
      if (!eventChannels.includes(channel)) throw new Error(`Unknown event channel "${channel}"`);
      return on(channel, cb);
    },
  };
}
