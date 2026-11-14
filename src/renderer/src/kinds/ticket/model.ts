/** Pure helpers of the ticket kind: workflow, "mark done" fallback, related items. */
import type { JiraIssue } from '../../../../shared/integrations/jira';

/** The main flow of the (mock) workflow, in order. A real site's workflow is whatever Jira allows. */
const FLOW = ['To Do', 'In Progress', 'In Review', 'Done'];

/** Statuses to walk through to reach Done step by step (used when a direct transition is rejected). */
export function stepsToDone(status: string): string[] {
  const at = FLOW.findIndex((s) => s.toLowerCase() === status.toLowerCase());
  if (at === FLOW.length - 1) return [];
  if (at < 0) return status.toLowerCase() === 'blocked' ? FLOW.slice(1) : ['Done'];
  return FLOW.slice(at + 1);
}

export type DoneResult = { ok: true; via: 'direct' | 'steps' } | { ok: false; error: string };

/**
 * Transition to Done; when Jira rejects it directly, walk the workflow one step at a time.
 * `transition` is `jiraOps.transition` (injected for tests).
 */
export async function transitionToDone(key: string, status: string, transition: (key: string, status: string) => Promise<void>): Promise<DoneResult> {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
  try {
    await transition(key, 'Done');
    return { ok: true, via: 'direct' };
  } catch (direct) {
    const steps = stepsToDone(status).filter((s) => s !== 'Done');
    if (steps.length === 0) return { ok: false, error: text(direct) };
    try {
      for (const s of [...steps, 'Done']) await transition(key, s);
      return { ok: true, via: 'steps' };
    } catch (e) {
      return { ok: false, error: text(e) };
    }
  }
}

/** Display text of a Jira user-ish value. */
export const personName = (u: { displayName: string } | null | undefined) => u?.displayName ?? 'unassigned';

/** "blocks CTX-1" / "is blocked by CTX-2" rows of an issue's links. */
export function linkRows(issue: Pick<JiraIssue['fields'], 'issuelinks'>): { id: string; relation: string; key: string; summary: string; status?: string }[] {
  return (issue.issuelinks ?? []).flatMap((l, i) => {
    const out = l.outwardIssue ? { relation: l.type.outward, ref: l.outwardIssue } : l.inwardIssue ? { relation: l.type.inward, ref: l.inwardIssue } : undefined;
    return out ? [{ id: l.id ?? String(i), relation: out.relation, key: out.ref.key, summary: out.ref.fields.summary, status: out.ref.fields.status?.name }] : [];
  });
}

/** Items related to a ticket on the canvas: what links to it, plus the PRs of its worktrees. */
export function relatedIds(links: { from: string; to: string }[], id: string, kindOf: (id: string) => string | undefined): string[] {
  const near = (x: string) => links.filter((l) => l.from === x || l.to === x).map((l) => (l.from === x ? l.to : l.from));
  const direct = near(id);
  const viaWorktree = direct.filter((d) => kindOf(d) === 'worktree').flatMap((w) => near(w).filter((o) => kindOf(o) === 'pr'));
  return [...new Set([...direct, ...viaWorktree])].filter((x) => x !== id && kindOf(x) !== 'project');
}
