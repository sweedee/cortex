import type { ViewState, WorkTab } from '../model/types';
import { getState, setState } from './store';

/**
 * Tiny hash router so views are deep-linkable and survive a reload:
 *   #/                         → global chat
 *   #/<workId>/<tab>           → a work item's tab
 *   #/<workId>/agents/<sid>    → a specific session
 */
const TABS: WorkTab[] = ['ticket', 'agents', 'review', 'pipeline', 'preview'];

function parse(hash: string): ViewState {
  const [workId, tab, sessionId] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (!workId || !getState().work.some((w) => w.id === workId)) return { workId: null, tab: 'ticket' };
  return { workId, tab: TABS.includes(tab as WorkTab) ? (tab as WorkTab) : 'ticket', sessionId: sessionId || undefined };
}

function format(v: ViewState): string {
  if (!v.workId) return '#/';
  return '#/' + [v.workId, v.tab, v.tab === 'agents' ? v.sessionId : undefined].filter(Boolean).map((p) => encodeURIComponent(p!)).join('/');
}

export function initRouter() {
  const apply = () => {
    if (format(getState().view) !== (window.location.hash || '#/')) {
      setState((s) => ({ ...s, view: parse(window.location.hash) }));
    }
  };
  apply();
  window.addEventListener('hashchange', apply);
}

/** Call after every store change to keep the URL in sync. */
export function syncHash() {
  const target = format(getState().view);
  if ((window.location.hash || '#/') !== target) window.history.replaceState(null, '', target);
}
