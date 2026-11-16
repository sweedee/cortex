/**
 * Dev / test overrides that must not work in a production run (`lib/runtime.ts`): they swap binaries
 * and scripts (`CORTEX_CLAUDE_BIN`, `CORTEX_JIRA_MOCK_SCRIPT`), allow the Vite dev server's origin
 * (`CORTEX_DEV_ORIGIN`, `CORTEX_DEV_URL`), or override config.json (`CORTEX_JIRA_CLI`, `CORTEX_JIRA_SITE`,
 * `CORTEX_AI_REVIEW_COMMENT`, `CORTEX_RENOVATE_APP`: production is configured through
 * `~/.cortex/config.json`). `CORTEX_USER_DATA`, `PORT`, `CORTEX_TOKEN` and `CORTEX_ALLOW_UNATTENDED` stay.
 */
const DEV_ONLY = [
  /^CORTEX_CLAUDE_BIN$/,
  /^CORTEX_JIRA_MOCK_SCRIPT$/,
  /^CORTEX_DEV_ORIGIN$/,
  /^CORTEX_DEV_URL$/,
  /^JIRA_MOCK_/,
  /^CORTEX_JIRA_CLI$/,
  /^CORTEX_JIRA_SITE$/,
  /^CORTEX_AI_REVIEW_COMMENT$/,
  /^CORTEX_RENOVATE_APP$/,
];

export const isDevOnlyEnvKey = (key: string): boolean => DEV_ONLY.some((re) => re.test(key));

/**
 * In production, delete the dev-only keys from `env` (in place, so every later reader and
 * every child process sees the same thing). Returns the removed keys.
 */
export function stripDevEnv(env: NodeJS.ProcessEnv, production: boolean): string[] {
  if (!production) return [];
  const removed = Object.keys(env).filter(isDevOnlyEnvKey);
  for (const k of removed) delete env[k];
  return removed;
}
