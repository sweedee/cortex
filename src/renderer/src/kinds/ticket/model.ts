/** Pure helpers of the ticket kind: workflow, "mark done" fallback, related items. */
import { MOCK_STATUS_OPTIONS, type JiraIssue, type JiraStatusOption } from '../../../../shared/integrations/jira';

/** Project key of an issue key (`CTX-12` → `CTX`). */
export const projectOfKey = (key: string) => key.replace(/-\d+$/, '');

/**
 * The options of "Change status…": the project's statuses (from `jira:statuses`), the mock's workflow
 * when none are known, and always the current status.
 */
export function statusOptions(known: JiraStatusOption[] | undefined, current: { name: string; category?: JiraStatusOption['category'] }): JiraStatusOption[] {
  const base = known && known.length ? known : MOCK_STATUS_OPTIONS;
  if (!current.name || base.some((s) => s.name.toLowerCase() === current.name.toLowerCase())) return base;
  return [...base, { name: current.name, category: current.category ?? 'undefined' }];
}

/** The workflow's main flow: blocked-like statuses left out, ordered to do → in progress → done. */
const flowOf = (statuses: JiraStatusOption[]) => statuses.filter((s) => !/block/i.test(s.name));

/** The status that means "done" (first of category done; "Done" when unknown). */
export const doneStatus = (statuses: JiraStatusOption[] = MOCK_STATUS_OPTIONS) => statuses.find((s) => s.category === 'done')?.name ?? 'Done';

/** Statuses to walk through to reach done step by step (used when a direct transition is rejected). */
export function stepsToDone(status: string, statuses: JiraStatusOption[] = MOCK_STATUS_OPTIONS): string[] {
  const flow = flowOf(statuses);
  const done = doneStatus(statuses);
  const doneAt = flow.findIndex((s) => s.name === done);
  const at = flow.findIndex((s) => s.name.toLowerCase() === status.toLowerCase());
  if (at >= 0 && flow[at].category === 'done') return [];
  if (at < 0) return /block/i.test(status) ? flow.slice(1, doneAt + 1).map((s) => s.name) : [done];
  return flow.slice(at + 1, doneAt + 1).map((s) => s.name);
}

export type DoneResult = { ok: true; via: 'direct' | 'steps' } | { ok: false; error: string };

/**
 * Transition to the done status; when Jira rejects it directly, walk the workflow one step at a time.
 * `transition` is `jiraOps.transition` (injected for tests); `statuses` the project's workflow.
 */
export async function transitionToDone(key: string, status: string, transition: (key: string, status: string) => Promise<void>, statuses: JiraStatusOption[] = MOCK_STATUS_OPTIONS): Promise<DoneResult> {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const done = doneStatus(statuses);
  try {
    await transition(key, done);
    return { ok: true, via: 'direct' };
  } catch (direct) {
    const steps = stepsToDone(status, statuses).filter((s) => s !== done);
    if (steps.length === 0) return { ok: false, error: text(direct) };
    try {
      for (const s of [...steps, done]) await transition(key, s);
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
