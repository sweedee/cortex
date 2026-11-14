/** Reduces a project's open PR list to the counts and top rows the sidebar shows. Pure. */
import { isRenovatePr, summarizePr, type GhPrListItem, type PrSummary } from '../../../../shared/integrations/github';

export interface OpenPrSummary {
  /** open PRs without Renovate's */
  total: number;
  renovate: number;
  /** count by review state: draft / open (review required) / approved / changes-requested */
  byState: Record<'draft' | 'open' | 'approved' | 'changes-requested', number>;
  failing: number;
  pending: number;
  /** newest-updated first */
  top: PrSummary[];
}

export function summarizeOpenPrs(list: GhPrListItem[], top = 5, botLogin?: string): OpenPrSummary {
  const out: OpenPrSummary = { total: 0, renovate: 0, byState: { draft: 0, open: 0, approved: 0, 'changes-requested': 0 }, failing: 0, pending: 0, top: [] };
  const own: PrSummary[] = [];
  for (const pr of list) {
    if (pr.state !== 'OPEN') continue;
    if (isRenovatePr(pr, botLogin)) {
      out.renovate++;
      continue;
    }
    const s = summarizePr(pr);
    own.push(s);
    out.total++;
    if (s.state in out.byState) out.byState[s.state as keyof OpenPrSummary['byState']]++;
    if (s.checks === 'failed') out.failing++;
    else if (s.checks === 'pending') out.pending++;
  }
  out.top = own.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, top);
  return out;
}
