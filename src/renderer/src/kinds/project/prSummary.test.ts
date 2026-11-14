import { describe, expect, it } from 'vitest';
import type { GhPrListItem } from '../../../../shared/integrations/github';
import { summarizeOpenPrs } from './prSummary';

const pr = (n: number, extra: Partial<GhPrListItem> = {}): GhPrListItem => ({
  number: n,
  title: `PR ${n}`,
  state: 'OPEN',
  isDraft: false,
  url: `https://github.com/o/r/pull/${n}`,
  author: { login: 'sven', is_bot: false } as GhPrListItem['author'],
  headRefName: `feat/${n}`,
  baseRefName: 'main',
  labels: [],
  updatedAt: `2026-11-0${n}T10:00:00Z`,
  statusCheckRollup: [],
  reviewDecision: '',
  additions: 1,
  deletions: 1,
  ...extra,
});

describe('summarizeOpenPrs', () => {
  it('counts by review state and checks, separates Renovate, ignores closed', () => {
    const s = summarizeOpenPrs(
      [
        pr(1, { reviewDecision: 'APPROVED' }),
        pr(2, { isDraft: true }),
        pr(3, { reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ __typename: 'StatusContext', state: 'FAILURE' } as never] }),
        pr(4, { headRefName: 'renovate/lodash-4.x' }),
        pr(5, { state: 'MERGED' }),
        pr(6),
      ],
      2,
    );
    expect(s.total).toBe(4);
    expect(s.renovate).toBe(1);
    expect(s.byState).toEqual({ draft: 1, open: 1, approved: 1, 'changes-requested': 1 });
    expect(s.failing).toBe(1);
    expect(s.top.map((p) => p.number)).toEqual([6, 3]);
  });
});
