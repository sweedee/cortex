/**
 * What the chat box sends to Claude Code (pure, unit-tested):
 *
 * - `buildPrompt`: the draft as typed (a leading `/skill` stays the slash command), plus a
 *   "Context" block with one line per @mentioned item, e.g.
 *   `@CTX-4821 = Jira ticket CTX-4821 "Retry exporter" (In Progress, branch feat/CTX-4821-retry)`
 * - `resolveCwd`: where the session runs: the most specific mentioned directory
 *   (worktree > a worktree linked to a mention > an app / test run / agent dir > the project's baseDir)
 * - `agentTarget`: exactly one real agent mentioned → the message goes to that session
 */
import { isRealPath, type Item, type ItemOf } from '../domain';
import type { KindCtx } from '../kinds/types';

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
const first = (s: string, max = 100) => {
  const l = s.trim().split(/\r?\n/)[0] ?? '';
  return l.length > max ? l.slice(0, max - 1) + '…' : l;
};
const paren = (parts: (string | undefined | false)[]) => {
  const p = parts.filter(Boolean);
  return p.length ? ` (${p.join(', ')})` : '';
};

/** One context line for an item: `@handle = what it is`. */
export function contextLine(item: Item, ctx: KindCtx): string {
  const at = `@${item.handle}`;
  switch (item.kind) {
    case 'project': {
      const d = item.data;
      return `${at} = project ${d.repo}${d.baseDir ? ` checked out at ${d.baseDir}` : ''}${paren([`default branch ${d.defaultBranch}`])}`;
    }
    case 'ticket': {
      const d = item.data;
      return `${at} = Jira ticket ${d.key} ${q(item.title)}${paren([d.status, d.type, d.branch && `branch ${d.branch}`])}`;
    }
    case 'worktree': {
      const d = item.data;
      return `${at} = git worktree at ${d.path} on branch ${d.branch}${paren([`base ${d.baseBranch}`, d.ticketKey && `ticket ${d.ticketKey}`])}`;
    }
    case 'record': {
      const d = item.data;
      return `${at} = ${d.recordType} record ${q(item.title)} at ${d.path}${paren([d.status, d.ticketKey && `ticket ${d.ticketKey}`])}`;
    }
    case 'pr': {
      const d = item.data;
      return `${at} = GitHub pull request ${d.repo}#${d.number} ${q(item.title)}${paren([d.headBranch && `${d.headBranch} → ${d.baseBranch}`, d.isDraft ? 'draft' : d.state])}`;
    }
    case 'agent': {
      const d = item.data;
      return `${at} = Claude Code session ${q(item.title)}${paren([d.cwd && `in ${d.cwd}`, d.status])}`;
    }
    case 'app': {
      const d = item.data;
      return `${at} = app started with \`${d.command}\`${paren([d.cwd && `in ${d.cwd}`, d.url, d.state])}`;
    }
    case 'build': {
      const d = item.data;
      return `${at} = CI build ${q(d.name)} on ${d.branch}${paren([d.conclusion ?? d.state, d.stage && `stage ${d.stage}`, d.url])}`;
    }
    case 'deployment': {
      const d = item.data;
      return `${at} = ${d.stageLabel ?? d.stage} deployment at ${d.url}${paren([d.version])}`;
    }
    case 'todo':
      return `${at} = todo: ${first(item.data.body || item.title)}`;
    case 'testrun': {
      const d = item.data;
      const s = d.summary;
      return `${at} = test run \`${d.command}\`${paren([d.cwd && `in ${d.cwd}`, d.state, s && `${s.passed} passed, ${s.failed} failed`])}`;
    }
  }
  // exhaustive above; keeps the linter happy if a kind is added
  return `${at} = ${(item as Item).title} (in ${ctx.projectOf(item)?.title ?? 'no project'})`;
}

/** The prompt sent to Claude: the draft unchanged + a context block for the mentioned items. */
export function buildPrompt(draft: string, mentioned: Item[], ctx: KindCtx): string {
  const text = draft.trim();
  if (!mentioned.length) return text;
  return `${text}\n\nContext (items mentioned above, from the Cortex canvas):\n${mentioned.map((m) => `- ${contextLine(m, ctx)}`).join('\n')}`;
}

/** The leading `/skill` of a draft, if any. */
export const skillOf = (draft: string) => draft.trim().match(/^\/([\w-]+)/)?.[1];

export interface CwdChoice {
  cwd: string;
  /** the item the directory came from */
  from: Item;
  /** the project the session belongs to */
  project?: ItemOf<'project'>;
}

/** Most specific working directory among the mentioned items (only real, absolute paths). */
export function resolveCwd(mentioned: Item[], ctx: KindCtx): CwdChoice | null {
  const projectOf = (i: Item) => (i.kind === 'project' ? i : ctx.projectOf(i));
  const pick = (from: Item, cwd: string | undefined): CwdChoice | null => (isRealPath(cwd) ? { cwd, from, project: projectOf(from) } : null);
  const tries: (() => CwdChoice | null)[] = [
    // 1. a mentioned worktree
    ...mentioned.filter((m) => m.kind === 'worktree').map((w) => () => pick(w, (w as ItemOf<'worktree'>).data.path)),
    // 2. a worktree linked to a mentioned ticket / PR / record (or with the ticket's key)
    ...mentioned.map((m) => () => {
      const linked = ctx.linked(m.id, 'worktree');
      const key = m.kind === 'ticket' ? m.data.key : m.kind === 'record' ? m.data.ticketKey : undefined;
      const byKey = key ? ctx.items.filter((i): i is ItemOf<'worktree'> => i.kind === 'worktree' && !i.archived && i.data.ticketKey === key) : [];
      for (const w of [...linked, ...byKey]) {
        const c = pick(w, w.data.path);
        if (c) return { ...c, from: m, project: c.project ?? projectOf(m) };
      }
      return null;
    }),
    // 3. a mentioned app / test run / agent directory
    ...mentioned.filter((m) => m.kind === 'app' || m.kind === 'testrun' || m.kind === 'agent').map((m) => () => pick(m, (m.data as { cwd: string }).cwd)),
    // 4. the project's base checkout
    ...mentioned.map((m) => () => {
      const p = projectOf(m);
      return p ? pick(m, p.data.baseDir) : null;
    }),
  ];
  for (const t of tries) {
    const c = t();
    if (c) return c;
  }
  return null;
}

/** The one real agent session the draft is addressed to (exactly one agent with a session mentioned). */
export function agentTarget(mentioned: Item[]): ItemOf<'agent'> | null {
  const agents = mentioned.filter((m): m is ItemOf<'agent'> => m.kind === 'agent');
  return agents.length === 1 && agents[0].data.localId ? agents[0] : null;
}

/** "Plan CTX-4821", "Chat wt/retry", from the skill and the first mention. */
const AGENT_TITLE: Record<string, string> = {
  plan: 'Plan',
  brainstorm: 'Brainstorm',
  grill: 'Grill',
  implement: 'Implement',
  rebase: 'Rebase',
  review: 'Review',
  'review-pr': 'Review',
  'address-review': 'Address review',
  'describe-pr': 'Describe',
  'fix-ci': 'Fix CI',
  'explain-build': 'Explain',
  'fix-tests': 'Fix tests',
  'create-ticket': 'New ticket',
  'review-renovate': 'Renovate',
};
export function agentTitle(skill: string | undefined, subject: Item | undefined): string {
  return `${skill ? (AGENT_TITLE[skill] ?? skill) : 'Chat'}${subject ? ` ${subject.handle}` : ''}`;
}

/** A handle not used by any item: `agent/implement-ctx4821`, then `-2`, `-3`, … */
export function agentHandle(skill: string | undefined, subject: Item | undefined, taken: (h: string) => boolean): string {
  // the ticket key when the subject has one (wt/CTX-4821-retry-… → ctx4821), else the end of its handle
  const key = subject?.handle.match(/[A-Z][A-Z0-9]+-\d+/)?.[0];
  const tail = subject ? (key ?? subject.handle).replace(/[^\w]/g, '').toLowerCase().slice(key ? 0 : -8) : '';
  const base = `agent/${(skill ?? 'chat') + (tail ? '-' + tail : '')}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}
