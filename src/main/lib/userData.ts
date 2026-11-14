/**
 * Where Cortex keeps its files. Default `~/.cortex` (workspace, window state, Claude session
 * metadata, Jira mock data); `CORTEX_USER_DATA=<dir>` for a separate profile. Chromium's own data
 * (cache, localStorage, webview logins) stays out of it: in Electron's default userData folder
 * (`%APPDATA%\cortex`, `~/Library/Application Support/cortex`, `~/.config/cortex`), or in
 * `<dir>/chromium` for a separate profile.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UserDataPaths {
  /** Cortex's files (Electron `userData`) */
  userData: string;
  /** Chromium session data (Electron `sessionData`) */
  sessionData: string;
}

export function resolveUserData(env: NodeJS.ProcessEnv, electronDefault: string, home = homedir()): UserDataPaths {
  const custom = env['CORTEX_USER_DATA'];
  if (custom) return { userData: custom, sessionData: join(custom, 'chromium') };
  return { userData: join(home, '.cortex'), sessionData: electronDefault };
}

/** Files carried over from the old location (Electron's userData) once. */
export const MIGRATED_FILES = ['workspace.json', 'workspace.json.bak', 'window-state.json', 'claude-sessions.json', 'jira-mock.json'];

/**
 * One-time move to `~/.cortex`: when it has no `workspace.json` yet but the old folder has one,
 * copy the Cortex files over (the old ones stay as they are). Returns the copied names.
 */
export function migrateUserData(from: string, to: string): string[] {
  if (from === to || existsSync(join(to, 'workspace.json')) || !existsSync(join(from, 'workspace.json'))) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const f of MIGRATED_FILES) {
    if (!existsSync(join(from, f)) || existsSync(join(to, f))) continue;
    copyFileSync(join(from, f), join(to, f));
    copied.push(f);
  }
  return copied;
}
