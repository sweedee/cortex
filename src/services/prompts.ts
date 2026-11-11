/**
 * The prompt each quick-action agent is started with. The mock ignores the wording
 * (it plays a script); with the real Claude this text is what gets sent, so tune it here.
 */
import type { AgentKind, WorkItem } from '../model/types';

export const AGENT_TITLES: Record<AgentKind, string> = {
  plan: 'Plan',
  implement: 'Implement',
  review: 'Self-review',
  'fix-ci': 'Fix CI',
  chat: 'Chat',
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
      return '';
  }
}
