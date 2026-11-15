/**
 * IPC contract between main, preload and renderer, declared once: `invokeChannels` /
 * `eventChannels` below. `CortexApi` (what the preload exposes as `window.cortex`) is derived
 * from them, and the preload's forwarders are generated from their keys (`./bridge.ts`).
 * This module must stay dependency free (types and plain values only): it is bundled into the
 * sandboxed preload. Runtime validation (zod) of every request lives in `./schemas.ts`, used by main.
 */

import type { ClaudeAnswers, ClaudeCatalog, ClaudeConfigureRequest, ClaudeConfigureResult, ClaudeEvent, ClaudeEventMessage, ClaudePermissionDecision, ClaudeSession, ClaudeSessionSummary, ClaudeStartRequest } from './integrations/claude';
import type { IntegrationConfig } from './integrations/config';
import type { GitDiffStat, GitLogEntry, GitRebaseResult, GitStatus, GitWorktree } from './integrations/git';
import type { GhCheck, GhMergeMethod, GhPrListItem, GhPullRequest, GhRun, GhUpdateBranchResult } from './integrations/github';
import type { JiraComment, JiraIssue, JiraStatusOption } from './integrations/jira';
import type { AppStartRequest, AppState, RunnerOutputEvent, TestRunRequest, TestState } from './integrations/runners';
import type { ConfigUpdateRequest, UserConfigState } from './userConfig';

/**
 * Commands `exec.run` may spawn. Bare names only, resolved on PATH (no shell). No `node`: with
 * arbitrary args that is arbitrary code; main runs its own scripts (jira-mock) itself.
 */
export const EXEC_ALLOWLIST = ['git', 'gh', 'claude', 'jira-mock'] as const;
export type ExecCommand = (typeof EXEC_ALLOWLIST)[number];

// ---- exec -------------------------------------------------------------------------------

export interface ExecRequest {
  cmd: ExecCommand;
  args: string[];
  /** absolute working directory */
  cwd: string;
  /** merged over the app's environment */
  env?: Record<string, string>;
  /** kill the process tree after this long (default 120 s) */
  timeoutMs?: number;
  /** written to stdin, then stdin is closed */
  stdin?: string;
}

export interface ExecResult {
  /** exit code; null when killed by a signal / timeout */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** stdout or stderr hit the output cap and the rest was dropped */
  truncated?: boolean;
}

// ---- long-running processes ---------------------------------------------------------------

export interface ProcStartRequest {
  /** caller-chosen id, unique among running processes */
  id: string;
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /**
   * Run through the OS shell. Only for commands the user configured themselves
   * (e.g. a project's `npm run dev`); everything else should stay shell-less.
   */
  shell?: boolean;
}

export interface ProcInfo {
  id: string;
  pid: number | undefined;
  cmd: string;
  args: string[];
  cwd: string;
  startedAt: number;
}

export interface ProcOutputEvent {
  id: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface ProcExitEvent {
  id: string;
  code: number | null;
  signal: string | null;
  /** set when the process could not be spawned at all */
  error?: string;
}

// ---- dialogs / shell ---------------------------------------------------------------------------

export interface PickDirectoryRequest {
  title?: string;
  defaultPath?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface PickFileRequest {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}

export interface OpenResult {
  ok: boolean;
  error?: string;
}

// ---- notifications --------------------------------------------------------------------------

export interface DesktopNotification {
  title: string;
  body: string;
  /** notifications with the same tag replace each other */
  tag?: string;
  /** sent back with `notify:clicked` */
  itemId?: string;
}

export interface NotifyClickedEvent {
  itemId?: string;
}

// ---- files ------------------------------------------------------------------------------------

export interface FsEntry {
  /** path relative to the listed dir, forward slashes */
  name: string;
  /** absolute path */
  path: string;
  isDir: boolean;
}

export interface FsListOptions {
  /** `*`, `?` and `**` (recursive); matched against the forward-slash relative path */
  glob?: string;
}

export interface FsChangedEvent {
  watchId: string;
  dir: string;
  /** `rename` = created / deleted / renamed, `change` = content changed */
  event: 'rename' | 'change';
  /** absolute path of the changed file; null when the OS did not say */
  path: string | null;
}

// ---- app ----------------------------------------------------------------------------------

export interface AppInfo {
  /** `process.platform` (win32, darwin, linux), or `browser` without the desktop shell */
  platform: string;
  userData: string;
  /** the user's home folder (`os.homedir()`; '' in the browser) */
  home?: string;
  version: string;
  electron?: string;
}

/** `<webview partition>`s the app uses; main refuses to attach a webview with any other partition. */
export const WEBVIEW_PARTITIONS = ['persist:github', 'persist:ci', 'persist:jira', 'persist:apps', 'persist:deployments', 'persist:gallery'] as const;

export interface RefusedRoot {
  path: string;
  reason: string;
}

// ---- integration requests -------------------------------------------------------------------

export interface GitDiffRequest {
  dir: string;
  /** diff against the merge base with this ref, working tree included */
  base?: string;
  staged?: boolean;
}

export interface GhPrListRequest {
  repo: string;
  author?: string;
  /** GitHub App slug, e.g. `renovate` */
  app?: string;
  search?: string;
  state?: 'open' | 'closed' | 'merged' | 'all';
  label?: string;
  head?: string;
  base?: string;
  limit?: number;
}

export interface GhPrCreateRequest {
  /** worktree the PR is created from */
  dir: string;
  title: string;
  body: string;
  /** may be another PR's head branch (stacked PR) */
  base: string;
  head: string;
  draft?: boolean;
  repo?: string;
}

/** `gh pr edit`: at least one of base / title / body */
export interface GhPrEditRequest {
  repo: string;
  number: number;
  /** new base branch (retarget) */
  base?: string;
  title?: string;
  body?: string;
}

export interface JiraCreateIssueRequest {
  project: string;
  type: string;
  summary: string;
  description?: string;
  assignee?: string;
  parent?: string;
}

export interface JiraEditIssueRequest {
  key: string;
  summary?: string;
  description?: string;
  assignee?: string;
  labels?: string[];
}


// ---- channels -------------------------------------------------------------------------------

/** Type-only marker: the value is a placeholder, the type carries the channel's [request, response]. */
const call = <Rq, Rs>() => 0 as unknown as [Rq, Rs];
/** Type-only marker for an event channel's payload. */
const event = <P>() => 0 as unknown as P;

/**
 * Request / response channels (ipcRenderer.invoke ↔ ipcMain.handle), named `group:method`. The
 * renderer calls `native.<group>.<method>(request)`. A channel here, its zod schema in `schemas.ts`
 * and its `handle()` in main are all a new call needs; the compiler and `ipcContract.test.ts`
 * point at whatever is missing (including the browser fallback in `renderer/src/native.ts`).
 */
export const invokeChannels = {
  'exec:run': call<ExecRequest, ExecResult>(),
  'proc:start': call<ProcStartRequest, ProcInfo>(),
  'proc:stop': call<{ id: string }, boolean>(),
  'proc:list': call<void, ProcInfo[]>(),
  'dialog:pickDirectory': call<PickDirectoryRequest, string | null>(),
  'dialog:pickFile': call<PickFileRequest, string | null>(),
  'shell:openExternal': call<{ url: string }, void>(),
  'shell:openPath': call<{ path: string }, OpenResult>(),
  'shell:openInEditor': call<{ path: string }, OpenResult>(),
  /** make an embedded <webview> page see `prefers-color-scheme: light | dark` (null = stop emulating) */
  'webview:setColorScheme': call<{ webContentsId: number; scheme: 'light' | 'dark' | null }, void>(),
  'notify:desktop': call<DesktopNotification, void>(),
  'workspace:load': call<void, unknown | null>(),
  'workspace:save': call<{ data: unknown }, void>(),
  'workspace:path': call<void, string>(),
  'fs:readText': call<{ path: string }, string>(),
  'fs:writeText': call<{ path: string; text: string }, void>(),
  'fs:list': call<{ dir: string; options?: FsListOptions }, FsEntry[]>(),
  /** start watching (recursively); returns a watch id for `unwatch` and the `fs:changed` events */
  'fs:watch': call<{ dir: string }, string>(),
  'fs:unwatch': call<{ watchId: string }, void>(),
  /** replace the folders the renderer works in (see ARCHITECTURE.md, Trust model); returns the refused ones */
  'fs:setRoots': call<{ roots: string[] }, RefusedRoot[]>(),
  'app:info': call<void, AppInfo>(),

  // integrations (git, gh, jira, claude, apps, tests); payload types live in `./integrations/*`
  'integrations:config': call<void, IntegrationConfig>(),

  'git:isRepo': call<{ dir: string }, boolean>(),
  'git:currentBranch': call<{ dir: string }, string | null>(),
  'git:remoteRepo': call<{ dir: string; remote?: string }, string | null>(),
  'git:worktreeList': call<{ repoDir: string }, GitWorktree[]>(),
  'git:worktreeAdd': call<{ repoDir: string; path: string; branch: string; base?: string; newBranch?: boolean }, GitWorktree>(),
  'git:worktreeRemove': call<{ repoDir: string; path: string; force?: boolean }, void>(),
  'git:status': call<{ dir: string }, GitStatus>(),
  'git:diff': call<GitDiffRequest, string>(),
  'git:diffStat': call<GitDiffRequest, GitDiffStat>(),
  'git:log': call<{ dir: string; range?: string; limit?: number }, GitLogEntry[]>(),
  'git:fetch': call<{ dir: string; remote?: string; prune?: boolean }, void>(),
  'git:rebase': call<{ dir: string; onto: string }, GitRebaseResult>(),
  'git:rebaseAbort': call<{ dir: string }, void>(),
  /** `git push [-u] <remote> HEAD` (remote default origin) */
  'git:push': call<{ dir: string; remote?: string; setUpstream?: boolean }, void>(),

  'gh:prList': call<GhPrListRequest, GhPrListItem[]>(),
  'gh:prView': call<{ repo: string; number: number }, GhPullRequest>(),
  'gh:prCreate': call<GhPrCreateRequest, { number: number; url: string }>(),
  'gh:prMerge': call<{ repo: string; number: number; method: GhMergeMethod; deleteBranch?: boolean }, void>(),
  /** without `body`: the configured AI-review trigger (`@claude review`) */
  'gh:prComment': call<{ repo: string; number: number; body?: string }, { url?: string }>(),
  'gh:prUpdateBranch': call<{ repo: string; number: number; rebase?: boolean }, GhUpdateBranchResult>(),
  /** `gh pr edit`: retarget (`base`) and / or change title / body */
  'gh:prEdit': call<GhPrEditRequest, void>(),
  'gh:prDiff': call<{ repo: string; number: number }, string>(),
  'gh:prChecks': call<{ repo: string; number: number }, GhCheck[]>(),
  'gh:runView': call<{ repo: string; runId: number }, GhRun>(),
  'gh:runRerun': call<{ repo: string; runId: number; failedOnly?: boolean }, void>(),
  'gh:renovatePrs': call<{ repo: string }, GhPrListItem[]>(),

  'jira:search': call<{ jql: string; limit?: number }, JiraIssue[]>(),
  'jira:view': call<{ key: string }, JiraIssue>(),
  'jira:transition': call<{ key: string; status: string }, void>(),
  'jira:create': call<JiraCreateIssueRequest, JiraIssue>(),
  'jira:comment': call<{ key: string; body: string }, JiraComment | null>(),
  'jira:edit': call<JiraEditIssueRequest, void>(),
  /** statuses used in a project (its workflow as far as acli can tell), ordered to do → done */
  'jira:statuses': call<{ project: string }, JiraStatusOption[]>(),

  'claude:start': call<ClaudeStartRequest, ClaudeSessionSummary>(),
  'claude:send': call<{ localId: string; text: string }, ClaudeSessionSummary>(),
  'claude:answer': call<{ localId: string; toolUseId: string; answers: ClaudeAnswers }, { via: 'tool' | 'message' }>(),
  'claude:permission': call<{ localId: string; requestId: string; decision: ClaudePermissionDecision }, void>(),
  'claude:interrupt': call<{ localId: string }, boolean>(),
  'claude:stop': call<{ localId: string }, boolean>(),
  'claude:remove': call<{ localId: string }, boolean>(),
  'claude:list': call<void, ClaudeSessionSummary[]>(),
  'claude:transcript': call<{ localId: string }, ClaudeEvent[]>(),
  'claude:session': call<{ localId: string }, ClaudeSession>(),
  /** change model / effort / permission mode (live when the process can take it) */
  'claude:configure': call<{ localId: string } & ClaudeConfigureRequest, ClaudeConfigureResult>(),
  /** slash commands, skills and models the CLI offers */
  'claude:catalog': call<void, ClaudeCatalog>(),

  'apps:start': call<AppStartRequest, AppState>(),
  'apps:stop': call<{ id: string }, boolean>(),
  'apps:restart': call<{ id: string }, AppState>(),
  'apps:list': call<void, AppState[]>(),
  'apps:log': call<{ id: string }, string>(),
  'apps:remove': call<{ id: string }, boolean>(),

  'tests:run': call<TestRunRequest, TestState>(),
  'tests:stop': call<{ id: string }, boolean>(),
  'tests:list': call<void, TestState[]>(),
  'tests:log': call<{ id: string }, string>(),

  // user config: `<userData>/config.json` (`./userConfig.ts`). `config:update` takes only the keys the
  // renderer may change (`RendererConfigPatchSchema`); `ifUnset`: only keys the file doesn't set yet
  'config:get': call<void, UserConfigState>(),
  'config:update': call<ConfigUpdateRequest, UserConfigState>(),
};

/** Events main pushes to the renderer (webContents.send ↔ ipcRenderer.on); `proc:exit` → `native.proc.onExit(cb)`. */
export const eventChannels = {
  'proc:output': event<ProcOutputEvent>(),
  'proc:exit': event<ProcExitEvent>(),
  'notify:clicked': event<NotifyClickedEvent>(),
  'fs:changed': event<FsChangedEvent>(),
  'claude:event': event<ClaudeEventMessage>(),
  'claude:state': event<ClaudeSessionSummary>(),
  'app:state': event<AppState>(),
  'app:output': event<RunnerOutputEvent>(),
  'test:state': event<TestState>(),
  'test:output': event<RunnerOutputEvent>(),
  /** config.json changed (through the app or edited by hand) */
  'config:changed': event<UserConfigState>(),
};

export type InvokeChannels = typeof invokeChannels;
export type InvokeChannel = keyof InvokeChannels;
export type Req<C extends InvokeChannel> = InvokeChannels[C][0];
export type Res<C extends InvokeChannel> = InvokeChannels[C][1];

export type EventChannels = typeof eventChannels;
export type EventChannel = keyof EventChannels;

export const INVOKE_CHANNELS = Object.keys(invokeChannels) as InvokeChannel[];
export const EVENT_CHANNELS = Object.keys(eventChannels) as EventChannel[];

export type Unsubscribe = () => void;

// ---- the bridge (derived) --------------------------------------------------------------------

type GroupOf<K> = K extends `${infer G}:${string}` ? G : never;
export type ApiGroupName = GroupOf<InvokeChannel | EventChannel>;

/** No request → `()`, an all-optional request → `(req?)`, otherwise `(req)`. */
export type ApiCall<C extends InvokeChannel> = [Req<C>] extends [void]
  ? () => Promise<Res<C>>
  : Partial<Req<C>> extends Req<C>
    ? (req?: Req<C>) => Promise<Res<C>>
    : (req: Req<C>) => Promise<Res<C>>;
export type ApiSubscribe<E extends EventChannel> = (cb: (payload: EventChannels[E]) => void) => Unsubscribe;

/** `native.<group>`: a method per invoke channel `<group>:<method>`, an `on<Event>` per event channel `<group>:<event>`. */
export type ApiGroup<G extends string> = {
  [C in InvokeChannel as C extends `${G}:${infer M}` ? M : never]: ApiCall<C>;
} & {
  [E in EventChannel as E extends `${G}:${infer M}` ? `on${Capitalize<M>}` : never]: ApiSubscribe<E>;
};

/**
 * What the preload exposes as `window.cortex` (built by `./bridge.ts`): `gh:prEdit` →
 * `cortex.gh.prEdit(req)`, `proc:exit` → `cortex.proc.onExit(cb)`. The renderer only talks to it via `native.ts`.
 */
export type CortexApi = { [G in ApiGroupName]: ApiGroup<G> } & {
  /** typed subscription to any event channel; returns an unsubscribe function */
  on<C extends EventChannel>(channel: C, cb: (payload: EventChannels[C]) => void): Unsubscribe;
};
