/**
 * IPC contract between main, preload and renderer. Plain types and channel names only:
 * this module must stay dependency free, it is bundled into the sandboxed preload.
 * Runtime validation (zod) of every request lives in `./schemas.ts`, used by main.
 */

/** Commands `exec.run` may spawn. Bare names only, resolved on PATH (no shell). */
export const EXEC_ALLOWLIST = ['git', 'gh', 'claude', 'node', 'jira-mock'] as const;
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
  version: string;
  electron?: string;
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
  'notify:desktop': [DesktopNotification, void];
  'workspace:load': [void, unknown | null];
  'workspace:save': [{ data: unknown }, void];
  'workspace:path': [void, string];
  'fs:readText': [{ path: string }, string];
  'fs:writeText': [{ path: string; text: string }, void];
  'fs:list': [{ dir: string; options?: FsListOptions }, FsEntry[]];
  'fs:watch': [{ dir: string }, string];
  'fs:unwatch': [{ watchId: string }, void];
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
  };
  app: {
    info(): Promise<AppInfo>;
  };
}
