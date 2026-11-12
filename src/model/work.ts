import type { WorkItem } from './types';

/** A review that somebody asked me for and I have not given yet. */
export const awaitsMyReview = (w: WorkItem, me: string) =>
  !!w.pr?.reviewRequested && w.pr.reviewers.some((r) => r.name === me && r.state === 'pending');
