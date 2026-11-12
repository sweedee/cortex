import { useSyncExternalStore } from 'react';
import type { AgentSession, CortexState, WorkItem } from '../model/types';

/**
 * Minimal external store. Lives outside React so the sync layer
 * (state/sync.ts: polling, Claude events) can update it freely.
 * Empty until boot() in state/sync.ts has loaded everything from the services.
 */
let state: CortexState = {
  ready: false,
  me: '',
  work: [],
  sessions: [],
  backlog: [],
  todos: [],
  toolbox: [],
  projects: [],
  skills: [],
  notifications: [],
  renovate: {},
  view: { workId: null, tab: 'ticket' },
  dialog: null,
  busy: {},
};
const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(update: (s: CortexState) => CortexState) {
  state = update(state);
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Select a slice of state. Selectors must return a stable reference for unchanged state. */
export function useCortex<T>(selector: (s: CortexState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---- convenience hooks -----------------------------------------------------

export const useWork = (workId: string | null | undefined): WorkItem | undefined =>
  useCortex((s) => s.work.find((w) => w.id === workId));

export const useSession = (sessionId: string | undefined): AgentSession | undefined =>
  useCortex((s) => s.sessions.find((x) => x.id === sessionId));

/** All sessions of a work item, newest first. */
export function useWorkSessions(workId: string): AgentSession[] {
  const sessions = useCortex((s) => s.sessions);
  return sessions
    .filter((x) => x.workId === workId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export const useBusy = (workId: string, action: string): boolean =>
  useCortex((s) => !!s.busy[`${workId}:${action}`]);

// ---- update helpers (used by actions) --------------------------------------

export function patchWork(workId: string, patch: (w: WorkItem) => Partial<WorkItem>) {
  setState((s) => ({
    ...s,
    work: s.work.map((w) =>
      w.id === workId ? { ...w, ...patch(w), updatedAt: new Date().toISOString() } : w,
    ),
  }));
}

export function patchSession(sessionId: string, patch: (x: AgentSession) => Partial<AgentSession>) {
  setState((s) => ({
    ...s,
    sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, ...patch(x) } : x)),
  }));
}

export function setBusy(workId: string, action: string, busy: boolean) {
  setState((s) => ({ ...s, busy: { ...s.busy, [`${workId}:${action}`]: busy } }));
}
