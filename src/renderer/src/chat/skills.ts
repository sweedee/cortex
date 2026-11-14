/**
 * Cortex's skills: every skill a kind action inserts (`skill(id, label, 'name')`) has a line here.
 * The composers also offer the CLI's own commands and skills (`claude:catalog`).
 */
export const SKILLS: { name: string; desc: string }[] = [
  { name: 'create-ticket', desc: 'Draft a Jira ticket for a project' },
  { name: 'review-renovate', desc: 'Review and merge safe dependency updates' },
  { name: 'brainstorm', desc: 'Explore options for a ticket into a brainstorm record' },
  { name: 'plan', desc: 'Explore the code and write a plan record' },
  { name: 'grill', desc: 'Poke holes in a plan before approving it' },
  { name: 'implement', desc: 'Implement a plan in its worktree' },
  { name: 'rebase', desc: 'Rebase a branch and resolve the conflicts' },
  { name: 'review', desc: 'Critical review of a worktree before a PR' },
  { name: 'review-pr', desc: 'Review a pull request' },
  { name: 'address-review', desc: 'Fix unresolved review comments' },
  { name: 'describe-pr', desc: 'Write the PR description from the diff' },
  { name: 'fix-ci', desc: 'Find why a build failed and fix it' },
  { name: 'explain-build', desc: 'Explain a CI failure without changing code' },
  { name: 'fix-tests', desc: 'Find why tests fail and fix them' },
  { name: 'status-summary', desc: 'Summarise where these items stand' },
  { name: 'continue-session', desc: 'Send a follow-up to an agent session' },
  { name: 'fork-session', desc: 'Branch a session to try another approach' },
];
