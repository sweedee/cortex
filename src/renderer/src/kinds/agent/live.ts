/**
 * Live sync of agent items (`KindModule.live`, started by `sync/live.ts`):
 *
 * - `claude:state` → the agent item with that `data.localId` (status, question, permissions,
 *   activity, usage) + a notice on transitions; the session query is refreshed
 * - `claude:event` → appended to the transcript cache (if loaded), batched once per animation frame;
 *   the cache is dropped when its agent item is removed (or archived and not on screen)
 * - startup: sessions main does not know become idle; known ones take main's state
 */
import type { ClaudeEvent, ClaudeSessionSummary } from '../../../../shared/integrations/claude';
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import type { Item } from '../../domain';
import { native } from '../../native';
import { subscribe } from '../../store';
import { mapClaudeState, STALE } from '../../sync/mapping';
import { applyMapped, itemsWhere, markStale } from '../live';
import type { LiveSync } from '../types';

export const agentsFor = (localId: string) => itemsWhere('agent', (a) => a.data.localId === localId);

export function onClaudeState(s: ClaudeSessionSummary, opts = { notices: true }) {
  for (const a of agentsFor(s.localId)) applyMapped(a, mapClaudeState(s, a.data, a.title), opts);
}

// session refetch, debounced per session (state events come with every stream event)
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
function refreshSession(localId: string) {
  if (sessionTimers.has(localId)) return;
  sessionTimers.set(
    localId,
    setTimeout(() => {
      sessionTimers.delete(localId);
      void queryClient.invalidateQueries({ queryKey: qk.claude.session(localId), exact: true });
      void queryClient.invalidateQueries({ queryKey: qk.claude.list() });
    }, 300),
  );
}

// claude:event → the transcript cache, one update per frame (a streaming turn sends dozens a second)
const pendingEvents = new Map<string, ClaudeEvent[]>();
let flushScheduled = false;
const nextFrame = (f: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));

/** Append the queued events to their transcript caches now (exported for tests). */
export function flushClaudeEvents() {
  flushScheduled = false;
  for (const [localId, events] of pendingEvents) {
    queryClient.setQueryData<ClaudeEvent[]>(qk.claude.transcript(localId), (old) => (old ? old.concat(events) : old));
  }
  pendingEvents.clear();
}

export function queueClaudeEvent(localId: string, event: ClaudeEvent) {
  const list = pendingEvents.get(localId);
  if (list) list.push(event);
  else pendingEvents.set(localId, [event]);
  if (flushScheduled) return;
  flushScheduled = true;
  // a hidden window gets no frames: fall back to a timer so the queue cannot grow unbounded
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    flushClaudeEvents();
  };
  nextFrame(run);
  setTimeout(run, 250);
}

/** Agent items → transcript caches to keep: a removed agent loses its cache, an archived one too unless a sidebar shows it. */
export function evictTranscripts(items: readonly Item[], prev: readonly Item[]) {
  const live = new Set<string>();
  const archived = new Set<string>();
  for (const i of items) if (i.kind === 'agent' && i.data.localId) (i.archived ? archived : live).add(i.data.localId);
  for (const i of prev) {
    // only agents that were on the canvas before (one archived earlier was handled then; gcTime does the rest)
    const id = i.kind === 'agent' && !i.archived ? i.data.localId : undefined;
    if (!id || live.has(id)) continue;
    const key = qk.claude.transcript(id);
    if (archived.has(id) && (queryClient.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount() ?? 0) > 0) continue;
    pendingEvents.delete(id);
    queryClient.removeQueries({ queryKey: key, exact: true });
  }
}

export const agentLive: LiveSync<'agent', ClaudeSessionSummary[]> = {
  start: () => {
    const offs = [
      native.on('claude:state', (s) => {
        onClaudeState(s);
        refreshSession(s.localId);
      }),
      native.on('claude:event', ({ localId, event }) => queueClaudeEvent(localId, event)),
      subscribe((s, prev) => {
        if (s.items !== prev.items) evictTranscripts(s.items, prev.items);
      }),
    ];
    return () => offs.forEach((off) => off());
  },
  list: () => native.claude.list(),
  reconcile: (item, sessions) => {
    if (!item.data.localId) return;
    const s = sessions.find((x) => x.localId === item.data.localId);
    if (s) onClaudeState(s, { notices: false });
    else markStale(item, STALE.agent(item.data));
  },
};
