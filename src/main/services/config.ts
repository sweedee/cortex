/**
 * Integration config for main: the shared defaults ← `<userData>/config.json` (`lib/userConfig.ts`,
 * schema in `shared/userConfig.ts`) ← environment overrides, and the resolution of the Jira CLI (real
 * `acli`, or the mock script via node).
 *
 * The env overrides are for development and tests: a packaged build strips them first thing
 * (`lib/devEnv.ts`), so an installed app is configured through config.json only.
 *
 *   CORTEX_JIRA_CLI=acli|mock         which Jira CLI to use (config `jira.cli`, default acli; smoke runs default
 *                                     to mock; acli not on PATH → mock, see `JiraService.site` / `initServices`)
 *   CORTEX_JIRA_SITE=<url>            Jira site for links (config `jira.site`; default: acli's `auth status`, mock: JIRA_MOCK_SITE)
 *   CORTEX_JIRA_MOCK_SCRIPT=<path>    jira-mock entry (default <app>/scripts/jira-mock/jira-mock.mjs)
 *   JIRA_MOCK_DB=<file>               mock data file (default <userData>/jira-mock.json)
 *   JIRA_MOCK_SITE=<url>              the mock's site (default https://example.atlassian.net)
 *   CORTEX_CLAUDE_BIN=<path>          claude binary (config `claude.bin`, default `claude` on PATH); a `.js` / `.mjs`
 *                                     path runs with Electron's node (e.g. src/main/services/__fixtures__/fake-claude.mjs)
 *   CORTEX_AI_REVIEW_COMMENT=<text>   PR comment that triggers the AI review (config `github.aiReviewComment`)
 *   CORTEX_RENOVATE_APP=<slug>        Renovate GitHub App slug (config `github.renovate.app`)
 */
import { join } from 'node:path';
import { DEFAULT_CONFIG, type IntegrationConfig } from '../../shared/integrations/config';
import { DEFAULT_USER_CONFIG, type UserConfig } from '../../shared/userConfig';

export function resolveConfig(env: NodeJS.ProcessEnv = process.env, user: UserConfig = DEFAULT_USER_CONFIG): IntegrationConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  applyUserConfig(c, user, env);
  c.jira.cli = user.jira.cli;
  const cli = env['CORTEX_JIRA_CLI'];
  if (cli === 'acli' || cli === 'mock') c.jira.cli = cli;
  // headless smoke runs never touch a real Jira unless asked to
  else if (env['CORTEX_SMOKE'] === '1') c.jira.cli = 'mock';
  if (c.jira.cli === 'mock' && !jiraSiteFixed(env, user)) c.jira.site = env['JIRA_MOCK_SITE'] || 'https://example.atlassian.net';
  // chosen on purpose (env, or "mock" in config.json): no automatic fallback to the mock
  c.jira.explicit = cli === 'acli' || cli === 'mock' || user.jira.cli === 'mock' || undefined;
  c.claude.bin = env['CORTEX_CLAUDE_BIN'] || user.claude.bin;
  return c;
}

/** The Jira site was set by hand (env or config.json): acli's `auth status` doesn't replace it. */
export const jiraSiteFixed = (env: NodeJS.ProcessEnv, user: UserConfig) => !!(env['CORTEX_JIRA_SITE'] || user.jira.site);

/**
 * The parts of config.json that apply while running (in place: the services hold these objects).
 * `claude.bin` and `jira.cli` need a restart.
 */
export function applyUserConfig(c: IntegrationConfig, user: UserConfig, env: NodeJS.ProcessEnv = process.env): void {
  c.github.aiReviewComment = env['CORTEX_AI_REVIEW_COMMENT'] || user.github.aiReviewComment;
  c.github.aiReviewBot = user.github.aiReviewBot;
  c.github.renovateApp = env['CORTEX_RENOVATE_APP'] || user.github.renovate.app;
  c.github.renovateLabel = user.github.renovate.label;
  const site = env['CORTEX_JIRA_SITE'] || user.jira.site;
  if (site) c.jira.site = site.replace(/\/+$/, '');
}

/** How to invoke the Jira CLI: `<command> <prefix…> jira workitem <subcommand…>`. */
export interface JiraCliSpec {
  command: string;
  prefix: string[];
  env: Record<string, string>;
}

/** Files that child processes execute can't live inside app.asar: packaged builds unpack them next to it. */
export const unpackedAsar = (p: string): string => p.replace(/app\.asar(?![\w.])/, 'app.asar.unpacked');

export function jiraCliSpec(cfg: IntegrationConfig, paths: { appRoot: string; userData: string; nodeBin?: string; isElectron?: boolean }, env = process.env): JiraCliSpec {
  if (cfg.jira.cli === 'acli') return { command: 'acli', prefix: [], env: {} };
  const script = env['CORTEX_JIRA_MOCK_SCRIPT'] || join(unpackedAsar(paths.appRoot), 'scripts', 'jira-mock', 'jira-mock.mjs');
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
