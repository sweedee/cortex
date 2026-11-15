import type { SyncStatus } from '../store';
import { agoText } from '../tones';

/** "Sync failing: <message> · last updated <relative time>" for the badge and the sidebar. */
export function syncTooltip(st: SyncStatus, now = Date.now()): string {
  const last = st.lastSyncedAt ? agoText(st.lastSyncedAt, now) : 'not yet this session';
  return `Sync failing: ${st.error?.message ?? 'unknown error'} · last updated ${last}`;
}
