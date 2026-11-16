/**
 * Where Cortex keeps its files: `~/.cortex` (config, workspace, Claude session metadata, Jira mock
 * data, logs), or `CORTEX_USER_DATA=<dir>` for a separate profile (tests, a second dev instance).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export function resolveUserData(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env['CORTEX_USER_DATA'] || join(home, '.cortex');
}
