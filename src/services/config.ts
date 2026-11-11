/**
 * Everything that is specific to one person's / one company's setup lives here,
 * so plugging in the real tools does not mean hunting through the code.
 */

/** Id of the global, work-independent Claude session (the "Ask Cortex" chat). */
export const GLOBAL_SESSION_ID = 'global';

export const config = {
  /** Repositories Cortex knows. Short names; the GitHub owner is prefixed by the real GitHubService. */
  repos: ['console-ui', 'ingest-gateway', 'query-service'],
  githubOwner: 'ctx-observability',
  baseBranch: 'main',
  /** New worktrees are created at `<worktreeRoot>/<repo>/<ticket key or slug>`. */
  worktreeRoot: '~/wt',

  jira: {
    /** Custom field ids differ per Jira site — check with `acli jira workitem view <KEY> --json --fields "*all"`. */
    fields: {
      storyPoints: 'customfield_10016',
      sprint: 'customfield_10020',
      acceptanceCriteria: 'customfield_10042',
    },
    /** JQL for the "assigned to me, not started in Cortex yet" list. */
    backlogJql: 'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC',
  },

  /** How often running things are re-fetched. Real tools are slower than the mocks — raise these (e.g. 10–15 s for CI). */
  poll: {
    ciMs: 1500,
    devServerMs: 600,
  },
};
