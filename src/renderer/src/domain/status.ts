/** Status buckets for filtering, derived from an item's ring (see `KindModule.ring`). */
import type { Segment, StatusGroup, Tone } from './types';

const has = (ring: Segment[], tone: Tone) => ring.some((s) => s.tone === tone);

export const STATUS_GROUPS: { id: StatusGroup; label: string; tone: Tone; test: (ring: Segment[]) => boolean }[] = [
  { id: 'attention', label: 'Needs attention', tone: 'warning', test: (r) => has(r, 'warning') },
  { id: 'failing', label: 'Failing / blocked', tone: 'critical', test: (r) => has(r, 'critical') },
  { id: 'running', label: 'Running', tone: 'running', test: (r) => has(r, 'running') },
  { id: 'active', label: 'In progress', tone: 'primary', test: (r) => has(r, 'primary') },
  { id: 'review', label: 'Pending / review', tone: 'pending', test: (r) => has(r, 'pending') },
  { id: 'done', label: 'Green / done', tone: 'success', test: (r) => has(r, 'success') },
  { id: 'idle', label: 'Idle / to do', tone: 'neutral', test: (r) => has(r, 'neutral') },
];
