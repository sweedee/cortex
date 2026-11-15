/**
 * Integration settings that are specific to one person's / company's setup. Defaults here;
 * main resolves overrides from the environment (`src/main/services/config.ts`).
 */

export interface IntegrationConfig {
  github: {
    /** PR comment that asks the AI reviewer bot for a review (`gh:prComment` without a body) */
    aiReviewComment: string;
    /** the bot that answers it */
    aiReviewBot: string;
    /** Renovate's GitHub App (`gh pr list --app <slug>`; author login `app/<slug>`) */
    renovateApp: string;
    /** label Renovate PRs carry in some repos (searched as well) */
    renovateLabel: string;
  };
  jira: {
    /** `acli` = the real Atlassian CLI on PATH (default); `mock` = `scripts/jira-mock` via node */
    cli: 'mock' | 'acli';
    /** site for browse URLs (`https://acme.atlassian.net`); for acli read from `acli jira auth status`, '' = unknown */
    site: string;
    /** the CLI was chosen with CORTEX_JIRA_CLI (no automatic fallback to the mock) */
    explicit?: boolean;
    /** why the effective setup differs from the default ("acli not found on PATH, using the mock") */
    note?: string;
    /** Jira cannot be used (acli missing or not logged in, packaged build): the UI shows `note` instead of data */
    unavailable?: boolean;
  };
  claude: {
    /** binary (resolved on PATH via cross-spawn) */
    bin: string;
    /** extra leading args (tests: the fake claude script) */
    prefixArgs: string[];
    defaultPermissionMode?: string;
  };
  runners: {
    /** output batching interval */
    flushMs: number;
    /** an app with no detected URL counts as running after this long */
    runningAfterMs: number;
  };
}

export const DEFAULT_CONFIG: IntegrationConfig = {
  github: { aiReviewComment: '@claude review', aiReviewBot: 'claude[bot]', renovateApp: 'renovate', renovateLabel: 'renovate' },
  jira: { cli: 'acli', site: '' },
  claude: { bin: 'claude', prefixArgs: [] },
  runners: { flushMs: 100, runningAfterMs: 8000 },
};
