/**
 * Dev / test overrides that must not work in an installed app: they swap binaries and scripts
 * (`CORTEX_CLAUDE_BIN`, `CORTEX_JIRA_MOCK_SCRIPT`), point the window at another URL
 * (`ELECTRON_RENDERER_URL`), drive the UI and quit (`CORTEX_SMOKE*`), or override config.json
 * (`CORTEX_JIRA_CLI`, `CORTEX_JIRA_SITE`, `CORTEX_AI_REVIEW_COMMENT`, `CORTEX_RENOVATE_APP`: an installed
 * app is configured through `~/.cortex/config.json`). Only `CORTEX_USER_DATA` stays: it must be known
 * before the config file can be found.
 */
const DEV_ONLY = [
  /^CORTEX_CLAUDE_BIN$/,
  /^CORTEX_JIRA_MOCK_SCRIPT$/,
  /^CORTEX_SMOKE/,
  /^ELECTRON_RENDERER_URL$/,
  /^JIRA_MOCK_/,
  /^CORTEX_JIRA_CLI$/,
  /^CORTEX_JIRA_SITE$/,
  /^CORTEX_AI_REVIEW_COMMENT$/,
  /^CORTEX_RENOVATE_APP$/,
];

export const isDevOnlyEnvKey = (key: string): boolean => DEV_ONLY.some((re) => re.test(key));

/**
 * In a packaged build, delete the dev-only keys from `env` (in place, so every later reader and
 * every child process sees the same thing). Returns the removed keys.
 */
export function stripDevEnv(env: NodeJS.ProcessEnv, packaged: boolean): string[] {
  if (!packaged) return [];
  const removed = Object.keys(env).filter(isDevOnlyEnvKey);
  for (const k of removed) delete env[k];
  return removed;
}
