/**
 * IPC contract between main, preload and renderer. Plain types and channel names only:
 * this module must stay dependency free, it is bundled into the sandboxed preload.
 * Runtime validation (zod) of every request lives in `./schemas.ts`, used by main.
 */

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

// ---- channels -------------------------------------------------------------------------------

/** Request / response channels (ipcRenderer.invoke ↔ ipcMain.handle): [request, response]. */
export interface InvokeChannels {
  'exec:run': [ExecRequest, ExecResult];
  'proc:start': [ProcStartRequest, ProcInfo];
  'proc:stop': [{ id: string }, boolean];
  'proc:list': [void, ProcInfo[]];
  'dialog:pickDirectory': [PickDirectoryRequest, string | null];
  'dialog:pickFile': [PickFileRequest, string | null];
  'shell:openExternal': [{ url: string }, void];
  'shell:openPath': [{ path: string }, OpenResult];
  'shell:openInEditor': [{ path: string }, OpenResult];
  'webview:setColorScheme': [{ webContentsId: number; scheme: 'light' | 'dark' | null }, void];
  'notify:desktop': [DesktopNotification, void];
  'workspace:load': [void, unknown | null];
  'workspace:save': [{ data: unknown }, void];
  'workspace:path': [void, string];
  'fs:readText': [{ path: string }, string];
  'fs:writeText': [{ path: string; text: string }, void];
  'fs:list': [{ dir: string; options?: FsListOptions }, FsEntry[]];
  'fs:watch': [{ dir: string }, string];
  'fs:unwatch': [{ watchId: string }, void];
  /** replace the folders the renderer works in (see ARCHITECTURE.md, Trust model); returns the refused ones */
  'fs:setRoots': [{ roots: string[] }, RefusedRoot[]];
  'app:info': [void, AppInfo];
}
export type InvokeChannel = keyof InvokeChannels;
export type Req<C extends InvokeChannel> = InvokeChannels[C][0];
export type Res<C extends InvokeChannel> = InvokeChannels[C][1];

/** Events main pushes to the renderer (webContents.send ↔ ipcRenderer.on). */
export interface EventChannels {
  'proc:output': ProcOutputEvent;
  'proc:exit': ProcExitEvent;
  'notify:clicked': NotifyClickedEvent;
  'fs:changed': FsChangedEvent;
}
export type EventChannel = keyof EventChannels;

export const EVENT_CHANNELS: EventChannel[] = ['proc:output', 'proc:exit', 'notify:clicked', 'fs:changed'];

export type Unsubscribe = () => void;

/** What the preload exposes as `window.cortex`. The renderer only talks to it via `native.ts`. */
export interface CortexApi {
  exec: {
    run(req: ExecRequest): Promise<ExecResult>;
  };
  proc: {
    start(req: ProcStartRequest): Promise<ProcInfo>;
    stop(id: string): Promise<boolean>;
    list(): Promise<ProcInfo[]>;
    onOutput(cb: (e: ProcOutputEvent) => void): Unsubscribe;
    onExit(cb: (e: ProcExitEvent) => void): Unsubscribe;
  };
  dialog: {
    pickDirectory(req?: PickDirectoryRequest): Promise<string | null>;
    pickFile(req?: PickFileRequest): Promise<string | null>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<OpenResult>;
    openInEditor(path: string): Promise<OpenResult>;
  };
  webview: {
    /** make an embedded <webview> page see `prefers-color-scheme: light | dark` (null = stop emulating) */
    setColorScheme(webContentsId: number, scheme: 'light' | 'dark' | null): Promise<void>;
  };
  notify: {
    desktop(n: DesktopNotification): Promise<void>;
    onClicked(cb: (e: NotifyClickedEvent) => void): Unsubscribe;
  };
  workspace: {
    load(): Promise<unknown | null>;
    save(data: unknown): Promise<void>;
    path(): Promise<string>;
  };
  fs: {
    readText(path: string): Promise<string>;
    writeText(path: string, text: string): Promise<void>;
    list(dir: string, options?: FsListOptions): Promise<FsEntry[]>;
    /** start watching (recursively); returns a watch id for `unwatch` and the events */
    watch(dir: string): Promise<string>;
    unwatch(watchId: string): Promise<void>;
    onChanged(cb: (e: FsChangedEvent) => void): Unsubscribe;
    /** the folders fs / shell / proc calls may touch (besides Cortex's own data folder); returns the refused ones */
    setRoots(roots: string[]): Promise<RefusedRoot[]>;
  };
  app: {
    info(): Promise<AppInfo>;
  };
}

// =============================================================================================
// Phase 1: integrations (git, gh, jira, claude, apps, tests). Declared by interface merging so
// this block is purely additive. Payload types live in `./integrations/*` (dependency free).
// =============================================================================================

import type { ClaudeAnswers, ClaudeCatalog, ClaudeConfigureRequest, ClaudeConfigureResult, ClaudeEvent, ClaudeEventMessage, ClaudePermissionDecision, ClaudeSession, ClaudeSessionSummary, ClaudeStartRequest } from './integrations/claude';
import type { IntegrationConfig } from './integrations/config';
import type { GitDiffStat, GitLogEntry, GitRebaseResult, GitStatus, GitWorktree } from './integrations/git';
import type { GhCheck, GhMergeMethod, GhPrListItem, GhPullRequest, GhRun, GhUpdateBranchResult } from './integrations/github';
import type { JiraComment, JiraIssue, JiraStatusOption } from './integrations/jira';
import type { AppStartRequest, AppState, RunnerOutputEvent, TestRunRequest, TestState } from './integrations/runners';

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

export interface InvokeChannels {
  'integrations:config': [void, IntegrationConfig];

  'git:isRepo': [{ dir: string }, boolean];
  'git:currentBranch': [{ dir: string }, string | null];
  'git:remoteRepo': [{ dir: string; remote?: string }, string | null];
  'git:worktreeList': [{ repoDir: string }, GitWorktree[]];
  'git:worktreeAdd': [{ repoDir: string; path: string; branch: string; base?: string; newBranch?: boolean }, GitWorktree];
  'git:worktreeRemove': [{ repoDir: string; path: string; force?: boolean }, void];
  'git:status': [{ dir: string }, GitStatus];
  'git:diff': [GitDiffRequest, string];
  'git:diffStat': [GitDiffRequest, GitDiffStat];
  'git:log': [{ dir: string; range?: string; limit?: number }, GitLogEntry[]];
  'git:fetch': [{ dir: string; remote?: string; prune?: boolean }, void];
  'git:rebase': [{ dir: string; onto: string }, GitRebaseResult];
  'git:rebaseAbort': [{ dir: string }, void];
  'git:push': [{ dir: string; remote?: string; setUpstream?: boolean }, void];

  'gh:prList': [GhPrListRequest, GhPrListItem[]];
  'gh:prView': [{ repo: string; number: number }, GhPullRequest];
  'gh:prCreate': [GhPrCreateRequest, { number: number; url: string }];
  'gh:prMerge': [{ repo: string; number: number; method: GhMergeMethod; deleteBranch?: boolean }, void];
  /** without `body`: the configured AI-review trigger (`@claude review`) */
  'gh:prComment': [{ repo: string; number: number; body?: string }, { url?: string }];
  'gh:prUpdateBranch': [{ repo: string; number: number; rebase?: boolean }, GhUpdateBranchResult];
  /** `gh pr edit`: retarget (`base`) and / or change title / body */
  'gh:prEdit': [GhPrEditRequest, void];
  'gh:prDiff': [{ repo: string; number: number }, string];
  'gh:prChecks': [{ repo: string; number: number }, GhCheck[]];
  'gh:runView': [{ repo: string; runId: number }, GhRun];
  'gh:runRerun': [{ repo: string; runId: number; failedOnly?: boolean }, void];
  'gh:renovatePrs': [{ repo: string }, GhPrListItem[]];

  'jira:search': [{ jql: string; limit?: number }, JiraIssue[]];
  'jira:view': [{ key: string }, JiraIssue];
  'jira:transition': [{ key: string; status: string }, void];
  'jira:create': [JiraCreateIssueRequest, JiraIssue];
  'jira:comment': [{ key: string; body: string }, JiraComment | null];
  'jira:edit': [JiraEditIssueRequest, void];
  /** statuses used in a project (its workflow as far as acli can tell), ordered to do → done */
  'jira:statuses': [{ project: string }, JiraStatusOption[]];

  'claude:start': [ClaudeStartRequest, ClaudeSessionSummary];
  'claude:send': [{ localId: string; text: string }, ClaudeSessionSummary];
  'claude:answer': [{ localId: string; toolUseId: string; answers: ClaudeAnswers }, { via: 'tool' | 'message' }];
  'claude:permission': [{ localId: string; requestId: string; decision: ClaudePermissionDecision }, void];
  'claude:interrupt': [{ localId: string }, boolean];
  'claude:stop': [{ localId: string }, boolean];
  'claude:remove': [{ localId: string }, boolean];
  'claude:list': [void, ClaudeSessionSummary[]];
  'claude:transcript': [{ localId: string }, ClaudeEvent[]];
  'claude:session': [{ localId: string }, ClaudeSession];
  'claude:configure': [{ localId: string } & ClaudeConfigureRequest, ClaudeConfigureResult];
  'claude:catalog': [void, ClaudeCatalog];

  'apps:start': [AppStartRequest, AppState];
  'apps:stop': [{ id: string }, boolean];
  'apps:restart': [{ id: string }, AppState];
  'apps:list': [void, AppState[]];
  'apps:log': [{ id: string }, string];
  'apps:remove': [{ id: string }, boolean];

  'tests:run': [TestRunRequest, TestState];
  'tests:stop': [{ id: string }, boolean];
  'tests:list': [void, TestState[]];
  'tests:log': [{ id: string }, string];
}

export interface EventChannels {
  'claude:event': ClaudeEventMessage;
  'claude:state': ClaudeSessionSummary;
  'app:state': AppState;
  'app:output': RunnerOutputEvent;
  'test:state': TestState;
  'test:output': RunnerOutputEvent;
}

EVENT_CHANNELS.push('claude:event', 'claude:state', 'app:state', 'app:output', 'test:state', 'test:output');

export interface CortexApi {
  integrations: {
    config(): Promise<IntegrationConfig>;
  };
  git: {
    isRepo(dir: string): Promise<boolean>;
    currentBranch(dir: string): Promise<string | null>;
    remoteRepo(dir: string, remote?: string): Promise<string | null>;
    worktreeList(repoDir: string): Promise<GitWorktree[]>;
    worktreeAdd(repoDir: string, path: string, branch: string, base?: string, opts?: { newBranch?: boolean }): Promise<GitWorktree>;
    worktreeRemove(repoDir: string, path: string, opts?: { force?: boolean }): Promise<void>;
    status(dir: string): Promise<GitStatus>;
    diff(dir: string, opts?: { base?: string; staged?: boolean }): Promise<string>;
    diffStat(dir: string, opts?: { base?: string; staged?: boolean }): Promise<GitDiffStat>;
    log(dir: string, opts?: { range?: string; limit?: number }): Promise<GitLogEntry[]>;
    fetch(dir: string, opts?: { remote?: string; prune?: boolean }): Promise<void>;
    rebase(dir: string, onto: string): Promise<GitRebaseResult>;
    rebaseAbort(dir: string): Promise<void>;
    /** `git push [-u] <remote> HEAD` (remote default origin) */
    push(dir: string, opts?: { remote?: string; setUpstream?: boolean }): Promise<void>;
  };
  gh: {
    prList(repo: string, filter?: Omit<GhPrListRequest, 'repo'>): Promise<GhPrListItem[]>;
    prView(repo: string, number: number): Promise<GhPullRequest>;
    prCreate(req: GhPrCreateRequest): Promise<{ number: number; url: string }>;
    prMerge(repo: string, number: number, method: GhMergeMethod, opts?: { deleteBranch?: boolean }): Promise<void>;
    /** without `body`: the configured AI-review trigger comment */
    prComment(repo: string, number: number, body?: string): Promise<{ url?: string }>;
    prUpdateBranch(repo: string, number: number, opts?: { rebase?: boolean }): Promise<GhUpdateBranchResult>;
    prEdit(req: GhPrEditRequest): Promise<void>;
    prDiff(repo: string, number: number): Promise<string>;
    prChecks(repo: string, number: number): Promise<GhCheck[]>;
    runView(repo: string, runId: number): Promise<GhRun>;
    runRerun(repo: string, runId: number, opts?: { failedOnly?: boolean }): Promise<void>;
    renovatePrs(repo: string): Promise<GhPrListItem[]>;
  };
  jira: {
    search(jql: string, opts?: { limit?: number }): Promise<JiraIssue[]>;
    view(key: string): Promise<JiraIssue>;
    transition(key: string, status: string): Promise<void>;
    create(req: JiraCreateIssueRequest): Promise<JiraIssue>;
    comment(key: string, body: string): Promise<JiraComment | null>;
    edit(req: JiraEditIssueRequest): Promise<void>;
    statuses(project: string): Promise<JiraStatusOption[]>;
  };
  claude: {
    start(req: ClaudeStartRequest): Promise<ClaudeSessionSummary>;
    send(localId: string, text: string): Promise<ClaudeSessionSummary>;
    answer(localId: string, toolUseId: string, answers: ClaudeAnswers): Promise<{ via: 'tool' | 'message' }>;
    permission(localId: string, requestId: string, decision: ClaudePermissionDecision): Promise<void>;
    interrupt(localId: string): Promise<boolean>;
    stop(localId: string): Promise<boolean>;
    remove(localId: string): Promise<boolean>;
    list(): Promise<ClaudeSessionSummary[]>;
    transcript(localId: string): Promise<ClaudeEvent[]>;
    session(localId: string): Promise<ClaudeSession>;
    /** change model / effort / permission mode (live when the process can take it) */
    configure(localId: string, c: ClaudeConfigureRequest): Promise<ClaudeConfigureResult>;
    /** slash commands, skills and models the CLI offers */
    catalog(): Promise<ClaudeCatalog>;
  };
  apps: {
    start(req: AppStartRequest): Promise<AppState>;
    stop(id: string): Promise<boolean>;
    restart(id: string): Promise<AppState>;
    list(): Promise<AppState[]>;
    log(id: string): Promise<string>;
    remove(id: string): Promise<boolean>;
  };
  tests: {
    run(req: TestRunRequest): Promise<TestState>;
    stop(id: string): Promise<boolean>;
    list(): Promise<TestState[]>;
    log(id: string): Promise<string>;
  };
  /** typed subscription to any event channel; returns an unsubscribe function */
  on<C extends EventChannel>(channel: C, cb: (payload: EventChannels[C]) => void): Unsubscribe;
}
