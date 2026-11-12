/**
 * Everything that is specific to one person's / one company's setup lives here,
 * so plugging in the real tools does not mean hunting through the code.
 */

/** Id of the global, work-independent Claude session (the "Ask Cortex" chat). */
export const GLOBAL_SESSION_ID = 'global';

/** Claude models the composer offers. `id` is what `claude --model <id>` takes. */
export const CLAUDE_MODELS = [
  { id: 'claude-fable-5-2', label: 'Fable', contextWindow: 1_000_000 },
  { id: 'claude-opus-5-5', label: 'Opus', contextWindow: 200_000 },
  { id: 'claude-sonnet-5-5', label: 'Sonnet', contextWindow: 200_000 },
  { id: 'claude-haiku-5-5', label: 'Haiku', contextWindow: 200_000 },
] as const;

/** Reasoning effort levels, lowest first (`claude --effort <level>` — verify with `claude --help`). */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Used for new sessions until the user picks something else (the last pick is remembered). */
export const CLAUDE_DEFAULTS: { model: string; effort: EffortLevel } = { model: 'claude-opus-5-5', effort: 'medium' };

const FALLBACK_MODEL = { id: '', label: '', contextWindow: 200_000 };
/** Model info by id; unknown ids (older sessions, other tools) get a generic 200k window and the id as label. */
export const modelInfo = (id: string): { id: string; label: string; contextWindow: number } =>
  CLAUDE_MODELS.find((m) => m.id === id) ?? { ...FALLBACK_MODEL, id, label: id.replace(/^claude-/, '') };

export const config = {
  /** Defaults for new projects. The repositories themselves are user data: see state/projects.ts. */
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

  /** AI review bot: a PR comment with `triggerComment` makes `botLogin` post a review (GitHubService.requestAiReview). */
  aiReview: {
    triggerComment: '@claude review',
    botLogin: 'claude[bot]',
  },

  /** How often running things are re-fetched. Real tools are slower than the mocks — raise these (e.g. 10–15 s for CI). */
  poll: {
    ciMs: 1500,
    devServerMs: 600,
    /** PR poll while the AI reviewer has not answered yet, and how long to keep waiting for it */
    prMs: 2000,
    aiReviewTimeoutMs: 180_000,
  },
};
