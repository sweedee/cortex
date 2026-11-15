/**
 * The link types: what a link between two bubbles means. `label` is what is stored and shown on
 * the link; `from` / `to` document which kinds it connects (`'*'` = any kind; the link test checks
 * the demo worlds against them). New links must use one of these labels (`LinkLabel`, checked by
 * `addLink` / `addItem`); stored links keep `label: string`, so a workspace with a label that is
 * no longer listed here still loads and shows it as it is.
 */
import type { Kind } from './types';

export interface LinkType {
  /** what the link means, read "from <label> to" */
  doc: string;
  from: readonly Kind[] | '*';
  to: readonly Kind[] | '*';
}

export const LINK_TYPES = {
  'in project': { doc: 'a ticket is part of a project (next to its projectId)', from: ['ticket'], to: ['project'] },
  'belongs to': { doc: 'an item added for a project (add dialog, a started agent)', from: '*', to: ['project'] },
  for: { doc: 'a todo is about a project or ticket', from: ['todo'], to: ['project', 'ticket'] },
  deploys: { doc: 'a deployment runs the project', from: ['deployment'], to: ['project'] },
  checks: { doc: 'a CI build of a pull request', from: ['build'], to: ['pr'] },
  'works on': { doc: "a worktree checks out the ticket's branch", from: ['worktree'], to: ['ticket'] },
  'from branch': { doc: "a pull request opened from a worktree's branch", from: ['pr'], to: ['worktree'] },
  implements: { doc: 'a pull request implements a ticket', from: ['pr'], to: ['ticket'] },
  'stacked on': { doc: "a pull request based on another one's head branch", from: ['pr'], to: ['pr'] },
  runs: { doc: 'an app started from a worktree', from: ['app'], to: ['worktree'] },
  tests: { doc: 'a test run in a worktree', from: ['testrun'], to: ['worktree'] },
  about: { doc: 'an agent session started with this item mentioned', from: ['agent'], to: '*' },
  'related to': { doc: 'linked by hand (multi-select → Link)', from: '*', to: '*' },
  'plan for': { doc: 'a plan record of a ticket / worktree', from: ['record'], to: ['ticket', 'worktree'] },
  'brainstorm for': { doc: 'a brainstorm record of a ticket / worktree', from: ['record'], to: ['ticket', 'worktree'] },
  'grill for': { doc: 'a grill record of a ticket / worktree', from: ['record'], to: ['ticket', 'worktree'] },
  'verification of': { doc: 'a verification record of a ticket / worktree', from: ['record'], to: ['ticket', 'worktree'] },
} as const satisfies Record<string, LinkType>;

/** A label new links may use. */
export type LinkLabel = keyof typeof LINK_TYPES;

export const isLinkLabel = (s: string): s is LinkLabel => Object.hasOwn(LINK_TYPES, s);

/** Does a link with this label fit these kinds? Unknown labels (from old files) never fit. */
export function linkFits(label: string, from: Kind, to: Kind): boolean {
  if (!isLinkLabel(label)) return false;
  const t: LinkType = LINK_TYPES[label];
  return (t.from === '*' || t.from.includes(from)) && (t.to === '*' || t.to.includes(to));
}
