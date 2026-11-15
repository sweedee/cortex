/**
 * Live sync of app items (`KindModule.live`): `app:state` → the app whose `data.procId` (or id)
 * matches, `app:output` → the log cache; at start, processes main does not know become stopped.
 */
import type { AppState } from '../../../../shared/integrations/runners';
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { native } from '../../native';
import { mapAppState, STALE } from '../../sync/mapping';
import { appendLog, applyMapped, itemsWhere, markStale } from '../live';
import type { LiveSync } from '../types';

export const appsFor = (id: string) => itemsWhere('app', (a) => a.data.procId === id || a.id === id);

export function onAppState(s: AppState, opts = { notices: true }) {
  for (const a of appsFor(s.id)) applyMapped(a, mapAppState(s, a.data), opts);
}

export const appLive: LiveSync<'app', AppState[]> = {
  start: () => {
    const offs = [
      native.on('app:state', (s) => {
        onAppState(s);
        void queryClient.invalidateQueries({ queryKey: qk.apps.list() });
      }),
      native.on('app:output', ({ id, chunk }) => appendLog(qk.apps.log(id), chunk)),
    ];
    return () => offs.forEach((off) => off());
  },
  list: () => native.apps.list(),
  reconcile: (item, apps) => {
    if (!item.data.procId) return;
    const s = apps.find((x) => x.id === item.data.procId);
    if (s) onAppState(s, { notices: false });
    else markStale(item, STALE.app(item.data));
  },
};
