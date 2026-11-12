/**
 * The prompt each quick-action agent is started with. The mock ignores the wording
 * (it plays a script); with the real Claude this text is what gets sent, so tune it here.
 */
import type { AgentKind, Project, WorkItem } from '../model/types';
import { config } from './config';

export const AGENT_TITLES: Record<AgentKind, string> = {
  plan: 'Plan',
  implement: 'Implement',
  review: 'Self-review',
  'fix-ci': 'Fix CI',
  chat: 'Chat',
  renovate: 'Renovate review',
};

export function promptFor(kind: AgentKind, work: WorkItem): string {
  const subject = work.ticket ? `${work.ticket.key} — ${work.ticket.summary}` : work.title;
  const ticket = work.ticket
    ? `\n\nTicket description:\n${work.ticket.descriptionMd}\n\nAcceptance criteria:\n${work.ticket.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
    : '';
  switch (kind) {
    case 'plan':
      return `Plan the implementation of ${subject}. Explore the code first, do not change anything. End with a concrete, step-by-step plan in markdown (context, approach, steps with file paths, test plan, risks).${ticket}`;
    case 'implement':
      return `Implement ${subject}.${work.planMd ? `\n\nFollow this plan:\n${work.planMd}` : ticket}\n\nWork in small commits, add tests, and run the relevant checks before you finish.`;
    case 'review': {
      const open = work.pr?.threads.filter((t) => !t.resolved) ?? [];
      return open.length > 0
        ? `Address the unresolved review comments on PR #${work.pr!.number}:\n${open.map((t) => `- ${t.filePath}:${t.line} — ${t.comments[0]?.body ?? ''}`).join('\n')}\n\nCommit and push the fixes, and summarise what you changed per comment.`
        : `Review the changes on this branch for ${subject} as a critical senior engineer would. Report findings; fix what is clearly wrong.`;
    }
    case 'fix-ci': {
      const failed = work.pipeline?.stages.find((s) => s.status === 'failed');
      return `The CI build #${work.pipeline?.buildNumber ?? '?'} for this branch failed${failed ? ` in stage "${failed.name}"` : ''}. Find the cause, fix it, and push.${failed ? `\n\nLog of the failing stage:\n${failed.log.slice(-6000)}` : ''}`;
    }
    case 'chat':
    case 'renovate': // belongs to a project: see renovatePrompt
      return '';
  }
}

/**
 * The "Review Renovate PRs" agent (project page). It works through `gh` only, so it does not need a worktree;
 * the bridge starts it in the project's main checkout for the repo's CLAUDE.md. Needs `gh` allowed for
 * `pr list|view|checks|diff|review|comment|merge` and web access for release notes (see HANDOFF, permissions).
 */
export function renovatePrompt(project: Project): string {
  const repo = `${project.github.owner}/${project.github.repo}`;
  const bot = config.renovate.author;
  return `Review the open dependency-update pull requests that Renovate (${bot}) has raised in ${repo}, and merge the ones that are safe.

Work through this for every PR, one at a time, using the \`gh\` CLI with \`--repo ${repo}\`:

1. List them: \`gh pr list --repo ${repo} --author "${bot}" --state open --json number,title,headRefName,labels,statusCheckRollup,reviewDecision\`. If there are none, say so and stop.
2. Understand the update. \`gh pr view <n> --repo ${repo}\` shows the package, the old and new version and Renovate's release-notes section. Classify it as patch, minor or major from the version numbers (do not trust the title alone). Read the changelog or release notes of every version between old and new (follow the links in the PR body, or fetch the GitHub release page). Look for breaking changes, removed or deprecated APIs, raised minimum runtime or peer-dependency versions, changed defaults, and security fixes.
3. Check the build. \`gh pr checks <n> --repo ${repo}\` must be completely green. Pending counts as not green: wait for it only if it finishes soon, otherwise leave the PR alone. If a check failed, read why (\`gh run view\` / the check's details link) and decide whether the update is the cause or the failure is unrelated or flaky. Never re-run, skip or override checks to make a PR mergeable.
4. Also glance at the diff (\`gh pr diff <n> --repo ${repo}\`): it should only touch manifests, lock files and, rarely, generated files. Anything else is a reason to stop and leave a comment.
5. Decide:
   - **Merge** when it is a patch or minor update, CI is green, the release notes show nothing breaking for how this project uses the package, and the PR only changes dependency files. Approve it (\`gh pr review <n> --repo ${repo} --approve --body "<one line why>"\`) and merge it (\`gh pr merge <n> --repo ${repo} --squash --delete-branch\`). Merge one at a time and look at \`gh pr list\` again between merges, because merging one PR can make the next one conflict or get rebased by Renovate; wait for Renovate to rebase and the build to turn green again before merging that one.
   - **Leave for a human** when it is a major update, when the build is red or still running, when the release notes mention breaking changes or migration steps, when you cannot find release notes, or when you are unsure. Do not merge, do not approve. Leave one comment on the PR (\`gh pr comment <n> --repo ${repo} --body "…"\`) that says what you checked and exactly what a person has to do (for example: "Major bump, v7 removes the legacy API X which we use in src/foo.ts; needs a code change before it can go in", or "Build fails in stage 'Unit tests': the new version changed Y, see log link"). Be specific and short.
6. Never push to Renovate's branches, close PRs, change labels, edit dependency files yourself or touch anything other than these PRs. If you need a decision that you cannot make from the facts above, ask me with the AskUserQuestion tool instead of guessing.

Finish with a summary in markdown, nothing after it: first one sentence (how many PRs, how many merged, how many need a human), then a table with the columns | PR | Update | Result |, one row per PR. \"PR\" is the number (#123), \"Update\" is the package, old and new version and the type, e.g. \"vite 8.3.5 -> 8.3.6 (patch)\", and \"Result\" is Merged, Needs human or Skipped, followed after a colon by the reason in a few words (e.g. \"Needs human: major bump\", \"Needs human: build red (Unit tests)\", \"Skipped: build still running\").`;
}
