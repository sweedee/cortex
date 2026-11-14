/**
 * Integration config for main: the shared defaults plus environment overrides, and the
 * resolution of the Jira CLI (real `acli`, or the mock script via node).
 *
 *   CORTEX_JIRA_CLI=acli|mock         which Jira CLI to use (default acli; smoke runs default to mock;
 *                                     acli not on PATH → mock, see `JiraService.site` / `initServices`)
 *   CORTEX_JIRA_SITE=<url>            Jira site for links (default: acli's `auth status`, mock: JIRA_MOCK_SITE)
 *   CORTEX_JIRA_MOCK_SCRIPT=<path>    jira-mock entry (default <app>/scripts/jira-mock/jira-mock.mjs)
 *   JIRA_MOCK_DB=<file>               mock data file (default <userData>/jira-mock.json)
 *   JIRA_MOCK_SITE=<url>              the mock's site (default https://example.atlassian.net)
 *   CORTEX_CLAUDE_BIN=<path>          claude binary (default `claude` on PATH); a `.js` / `.mjs` path runs with
 *                                     Electron's node (e.g. src/main/services/__fixtures__/fake-claude.mjs)
 *   CORTEX_AI_REVIEW_COMMENT=<text>   PR comment that triggers the AI review (default `@claude review`)
 *   CORTEX_RENOVATE_APP=<slug>        Renovate GitHub App slug (default renovate)
 */
import { join } from 'node:path';
import { DEFAULT_CONFIG, type IntegrationConfig } from '../../shared/integrations/config';

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): IntegrationConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  const cli = env['CORTEX_JIRA_CLI'];
  if (cli === 'acli' || cli === 'mock') c.jira.cli = cli;
  // headless smoke runs never touch a real Jira unless asked to
  else if (env['CORTEX_SMOKE'] === '1') c.jira.cli = 'mock';
  if (c.jira.cli === 'mock') c.jira.site = env['JIRA_MOCK_SITE'] || 'https://example.atlassian.net';
  if (env['CORTEX_JIRA_SITE']) c.jira.site = env['CORTEX_JIRA_SITE'];
  c.jira.explicit = cli === 'acli' || cli === 'mock' || undefined;
  if (env['CORTEX_CLAUDE_BIN']) c.claude.bin = env['CORTEX_CLAUDE_BIN'];
  if (env['CORTEX_AI_REVIEW_COMMENT']) c.github.aiReviewComment = env['CORTEX_AI_REVIEW_COMMENT'];
  if (env['CORTEX_RENOVATE_APP']) c.github.renovateApp = env['CORTEX_RENOVATE_APP'];
  return c;
}

/** How to invoke the Jira CLI: `<command> <prefix…> jira workitem <subcommand…>`. */
export interface JiraCliSpec {
  command: string;
  prefix: string[];
  env: Record<string, string>;
}

export function jiraCliSpec(cfg: IntegrationConfig, paths: { appRoot: string; userData: string; nodeBin?: string; isElectron?: boolean }, env = process.env): JiraCliSpec {
  if (cfg.jira.cli === 'acli') return { command: 'acli', prefix: [], env: {} };
  const script = env['CORTEX_JIRA_MOCK_SCRIPT'] || join(paths.appRoot, 'scripts', 'jira-mock', 'jira-mock.mjs');
  return {
    // Electron's own binary runs plain node scripts with ELECTRON_RUN_AS_NODE: no node on PATH needed
    command: paths.nodeBin ?? process.execPath,
    prefix: [script],
    env: {
      ...(paths.isElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      JIRA_MOCK_DB: env['JIRA_MOCK_DB'] || join(paths.userData, 'jira-mock.json'),
      JIRA_MOCK_SITE: cfg.jira.site || 'https://example.atlassian.net',
    },
  };
}
