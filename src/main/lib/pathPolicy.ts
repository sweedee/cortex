/**
 * Which files and folders the renderer may reach through `fs:*`, `shell:openPath`,
 * `shell:openInEditor` and the `cwd` of `proc:start` / `apps:start` / `tests:run`.
 *
 * Trust model (see ARCHITECTURE.md): the renderer shows untrusted content, so main does not let it
 * name any path. A path must lie inside an allowed root:
 *   - Cortex's own data folder (`~/.cortex`),
 *   - folders the user picked in a native dialog this session,
 *   - folders the renderer registers with `fs:setRoots` (project base checkouts, worktrees folders,
 *     worktrees, app / test cwds).
 * Registration is renderer-controlled too, so on top of that some paths are always refused: the
 * home folder itself and its ancestors / filesystem roots as roots, home dot-entries (`~/.ssh`,
 * `~/.aws`, `~/.gitconfig`, …), and OS autostart / shell-profile locations. Paths are compared after
 * `path.resolve` (no `..` escapes); symlinks inside a root are not resolved.
 *
 * Pure (platform, home and user data are passed in) so it is unit-tested on any OS.
 */
import { posix, win32 } from 'node:path';

export interface PathEnv {
  platform: NodeJS.Platform;
  home: string;
  /** Cortex's data folder (always allowed, even though it is `~/.cortex`) */
  userData: string;
  /** `%ProgramData%` on Windows (machine-wide Startup folder) */
  programData?: string;
}

const pathLib = (env: PathEnv) => (env.platform === 'win32' ? win32 : posix);

/** resolved, without trailing separator (except a bare root), lower-cased on case-insensitive platforms */
export function normPath(p: string, env: PathEnv): string {
  const lib = pathLib(env);
  let r = lib.resolve(p);
  const root = lib.parse(r).root;
  while (r.length > root.length && /[\\/]$/.test(r)) r = r.slice(0, -1);
  return env.platform === 'win32' || env.platform === 'darwin' ? r.toLowerCase() : r;
}

/** `child` is `parent` or inside it (both already normalised) */
function within(child: string, parent: string, env: PathEnv): boolean {
  if (child === parent) return true;
  const sep = pathLib(env).sep;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** absolute folders under home that are never reachable (besides home dot-entries) */
function sensitiveDirs(env: PathEnv): string[] {
  const j = (...p: string[]) => pathLib(env).join(...p);
  const h = env.home;
  if (env.platform === 'win32') {
    const dirs = [
      // Startup folders, the Start menu, WSH / PowerShell profiles
      j(h, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu'),
      j(h, 'Documents', 'WindowsPowerShell'),
      j(h, 'Documents', 'PowerShell'),
      'C:\\Windows',
    ];
    if (env.programData) dirs.push(j(env.programData, 'Microsoft', 'Windows', 'Start Menu'));
    return dirs;
  }
  if (env.platform === 'darwin') return [j(h, 'Library', 'LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons', '/System', '/etc', '/private/etc'];
  return ['/etc', '/boot', '/proc', '/sys'];
}

/** why `p` is never allowed, or undefined */
export function sensitiveReason(p: string, env: PathEnv): string | undefined {
  const n = normPath(p, env);
  const home = normPath(env.home, env);
  const ud = normPath(env.userData, env);
  if (within(n, ud, env)) return undefined;
  if (within(n, home, env) && n !== home) {
    const first = n.slice(home.length).split(/[\\/]/).find(Boolean) ?? '';
    if (first.startsWith('.')) return `${first} in the home folder is off limits`;
  }
  for (const d of sensitiveDirs(env)) if (within(n, normPath(d, env), env)) return 'system / autostart location';
  return undefined;
}

/** why `p` can't be registered as a root, or undefined */
export function rootRefusal(p: string, env: PathEnv): string | undefined {
  const n = normPath(p, env);
  const lib = pathLib(env);
  if (n === normPath(lib.parse(lib.resolve(p)).root, env)) return 'a filesystem root is too broad';
  if (within(normPath(env.home, env), n, env)) return 'the home folder (or a parent of it) is too broad';
  return sensitiveReason(p, env);
}

/** The allowed roots: user data + picked + renderer-registered. */
export class Roots {
  private registered: string[] = [];
  private readonly fixed: string[];
  private readonly picked = new Set<string>();
  private readonly env: PathEnv;

  constructor(env: PathEnv) {
    this.env = env;
    this.fixed = [normPath(env.userData, env)];
  }

  /** replace the renderer's roots; returns the refused ones */
  set(roots: string[]): { path: string; reason: string }[] {
    const refused: { path: string; reason: string }[] = [];
    const ok = new Set<string>();
    for (const r of roots) {
      const reason = rootRefusal(r, this.env);
      if (reason) refused.push({ path: r, reason });
      else ok.add(normPath(r, this.env));
    }
    this.registered = [...ok];
    return refused;
  }

  /** a path the user chose in a native dialog (or main itself trusts, e.g. the smoke repo) */
  add(p: string): boolean {
    if (rootRefusal(p, this.env)) return false;
    this.picked.add(normPath(p, this.env));
    return true;
  }

  /** why `p` is not reachable, or undefined */
  refusal(p: string): string | undefined {
    const sensitive = sensitiveReason(p, this.env);
    if (sensitive) return sensitive;
    const n = normPath(p, this.env);
    const all = [...this.fixed, ...this.picked, ...this.registered];
    return all.some((r) => within(n, r, this.env)) ? undefined : 'outside the folders Cortex works in (projects, worktrees, ~/.cortex)';
  }

  /** throw unless `p` is reachable */
  check(p: string, what = 'path'): void {
    const why = this.refusal(p);
    if (why) throw new Error(`${what} not allowed: ${p} (${why})`);
  }
}

/** Extensions `shell.openPath` would run instead of show (Windows, macOS and Linux launchers). */
export const EXECUTABLE_EXTENSIONS = [
  'exe', 'com', 'bat', 'cmd', 'lnk', 'pif', 'scr', 'cpl', 'msi', 'msp', 'msc', 'hta', 'reg', 'inf', 'scf', 'url', 'appref-ms', 'application', 'gadget',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'jar', 'py', 'pyw',
  'app', 'command', 'tool', 'pkg', 'workflow', 'terminal',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'bin', 'desktop', 'appimage',
] as const;

const execExt = new Set<string>(EXECUTABLE_EXTENSIONS);

/** `p` would launch something when opened with the OS default handler */
export function isExecutablePath(p: string): boolean {
  // Windows ignores trailing dots / spaces ("evil.exe. " runs evil.exe); NTFS streams ("a.txt:x.exe")
  const base = (p.split(/[\\/]/).pop() ?? '').replace(/[. ]+$/, '');
  if (base.includes(':')) return true;
  const dot = base.lastIndexOf('.');
  return dot > 0 && execExt.has(base.slice(dot + 1).toLowerCase());
}
