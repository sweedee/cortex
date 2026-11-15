/**
 * Live sync of test run items (`KindModule.live`): `test:state` → the run whose `data.procId` (or id)
 * matches, `test:output` → the log cache and `outputTail` (at most once a second; it is persisted);
 * at start, runs main does not know become idle.
 */
import type { TestState } from '../../../../shared/integrations/runners';
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { native } from '../../native';
import { patchData } from '../../store';
import { mapTestState, STALE, tailOf } from '../../sync/mapping';
import { appendLog, applyMapped, itemsWhere, markStale } from '../live';
import type { LiveSync } from '../types';

export const testrunsFor = (id: string) => itemsWhere('testrun', (t) => t.data.procId === id || t.id === id);

export function onTestState(s: TestState, opts = { notices: true }) {
  flushTail(s.id);
  for (const t of testrunsFor(s.id)) applyMapped(t, mapTestState(s, t.data), opts);
}

// test output → outputTail, at most once a second (it is persisted)
const tails = new Map<string, string>();
let tailTimer: ReturnType<typeof setTimeout> | undefined;
function flushTail(id?: string) {
  for (const [tid, chunk] of tails) {
    if (id && tid !== id) continue;
    tails.delete(tid);
    for (const t of testrunsFor(tid)) patchData<'testrun'>(t, { outputTail: tailOf((t.data.outputTail ?? '') + chunk) });
  }
}
function queueTail(id: string, chunk: string) {
  tails.set(id, (tails.get(id) ?? '') + chunk);
  tailTimer ??= setTimeout(() => {
    tailTimer = undefined;
    flushTail();
  }, 1000);
}

export const testrunLive: LiveSync<'testrun', TestState[]> = {
  start: () => {
    const offs = [
      native.on('test:state', (s) => {
        onTestState(s);
        void queryClient.invalidateQueries({ queryKey: qk.tests.list() });
      }),
      native.on('test:output', ({ id, chunk }) => {
        appendLog(qk.tests.log(id), chunk);
        queueTail(id, chunk);
      }),
    ];
    return () => offs.forEach((off) => off());
  },
  list: () => native.tests.list(),
  reconcile: (item, tests) => {
    if (!item.data.procId) return;
    const s = tests.find((x) => x.id === item.data.procId);
    if (s) onTestState(s, { notices: false });
    else markStale(item, STALE.testrun(item.data));
  },
};
