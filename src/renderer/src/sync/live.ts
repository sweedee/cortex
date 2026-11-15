/**
 * Live sync: main's push events → the canvas items and the query caches.
 *
 * - `claude:state` → the agent item with that `data.localId` (status, question, permissions,
 *   activity, usage) + a notice on transitions; the session query is refreshed
 * - `claude:event` → appended to the transcript cache (if loaded), batched once per animation frame;
 *   the cache is dropped when its agent item is removed (or archived and not on screen)
 * - `app:state` / `test:state` → the app / test run item whose `data.procId` (or id) matches
 * - `app:output` / `test:output` → appended to the log caches; test output also feeds `outputTail`
 *
 * `reconcile()` runs once at start: running items that main does not know (the app was
 * restarted) are set to stopped / idle; known ones take main's state.
 */
import type { ClaudeSessionSummary } from '../../../shared/integrations/claude';
import type { AppState, TestState } from '../../../shared/integrations/runners';
import type { ClaudeEvent } from '../../../shared/integrations/claude';
import { queryClient } from '../data/queryClient';
import { qk } from '../data/queryKeys';
import type { DataOf, Item, ItemOf, Kind } from '../domain';
import { isDesktop, native } from '../native';
import { getState, notify, patchData, subscribe } from '../store';
import { changes, mapAppState, mapClaudeState, mapTestState, STALE, tailOf, type Mapped, type NoticeSpec } from './mapping';

const LOG_MAX = 256 * 1024;

const ofKind = <K extends Kind>(kind: K, match: (i: ItemOf<K>) => boolean): ItemOf<K>[] =>
  getState().items.filter((i): i is ItemOf<K> => i.kind === kind && match(i as ItemOf<K>));

export const agentsFor = (localId: string) => ofKind('agent', (a) => a.data.localId === localId);
export const appsFor = (id: string) => ofKind('app', (a) => a.data.procId === id || a.id === id);
export const testrunsFor = (id: string) => ofKind('testrun', (t) => t.data.procId === id || t.id === id);

function apply<K extends Kind>(item: ItemOf<K>, m: Mapped<DataOf<K>>, opts: { notices: boolean }) {
  if (changes(item.data as object, m.patch)) patchData<K>(item, m.patch);
  if (opts.notices && m.notice) notify(item.id, m.notice as NoticeSpec);
}

// ---- handlers (exported for tests) --------------------------------------------------------

export function onClaudeState(s: ClaudeSessionSummary, opts = { notices: true }) {
  for (const a of agentsFor(s.localId)) apply(a, mapClaudeState(s, a.data, a.title), opts);
}

export function onAppState(s: AppState, opts = { notices: true }) {
  for (const a of appsFor(s.id)) apply(a, mapAppState(s, a.data), opts);
}

export function onTestState(s: TestState, opts = { notices: true }) {
  flushTail(s.id);
  for (const t of testrunsFor(s.id)) apply(t, mapTestState(s, t.data), opts);
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

const appendLog = (key: readonly unknown[], chunk: string) =>
  queryClient.setQueryData<string>(key, (old) => (old === undefined ? old : tailOf(old + chunk, LOG_MAX)));

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

let started = false;
/** Subscribe to main's events. Call once after the workspace is loaded. */
export function startLiveSync(): () => void {
  if (started || !isDesktop) return () => {};
  started = true;
  const offs = [
    native.on('claude:state', (s) => {
      onClaudeState(s);
      refreshSession(s.localId);
    }),
    native.on('claude:event', ({ localId, event }) => queueClaudeEvent(localId, event)),
    subscribe((s, prev) => {
      if (s.items !== prev.items) evictTranscripts(s.items, prev.items);
    }),
    native.on('app:state', (s) => {
      onAppState(s);
      void queryClient.invalidateQueries({ queryKey: qk.apps.list() });
    }),
    native.on('app:output', ({ id, chunk }) => appendLog(qk.apps.log(id), chunk)),
    native.on('test:state', (s) => {
      onTestState(s);
      void queryClient.invalidateQueries({ queryKey: qk.tests.list() });
    }),
    native.on('test:output', ({ id, chunk }) => {
      appendLog(qk.tests.log(id), chunk);
      queueTail(id, chunk);
    }),
  ];
  return () => {
    offs.forEach((off) => off());
    started = false;
  };
}

// ---- startup reconciliation ---------------------------------------------------------------

/**
 * Bring items that say they run in line with main: known sessions / processes take main's
 * state (without notices), unknown ones become idle / stopped. Only items that were really
 * started (agent `localId`, app / test run `procId`) are touched; demo items stay as they are.
 */
export async function reconcile(lists?: { sessions: ClaudeSessionSummary[]; apps: AppState[]; tests: TestState[] }) {
  if (!lists && !isDesktop) return;
  const l =
    lists ??
    (await Promise.all([native.claude.list(), native.apps.list(), native.tests.list()])
      .then(([sessions, apps, tests]) => ({ sessions, apps, tests }))
      .catch((e: unknown) => {
        console.warn('[sync] reconcile: could not list sessions / processes', e);
        return null;
      }));
  if (!l) return;
  const quiet = { notices: false };
  for (const item of getState().items as Item[]) {
    if (item.kind === 'agent' && item.data.localId) {
      const s = l.sessions.find((x) => x.localId === item.data.localId);
      if (s) onClaudeState(s, quiet);
      else stale(item, STALE.agent(item.data));
    } else if (item.kind === 'app' && item.data.procId) {
      const s = l.apps.find((x) => x.id === item.data.procId);
      if (s) onAppState(s, quiet);
      else stale(item, STALE.app(item.data));
    } else if (item.kind === 'testrun' && item.data.procId) {
      const s = l.tests.find((x) => x.id === item.data.procId);
      if (s) onTestState(s, quiet);
      else stale(item, STALE.testrun(item.data));
    }
  }
}

function stale(item: Item, patch: object | null) {
  if (patch) patchData(item.id, patch);
}
