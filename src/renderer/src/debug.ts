/**
 * Handle for the headless smoke probe (`CORTEX_SMOKE=1 CORTEX_SMOKE_E2E=1 npm run dev`,
 * src/main/smoke.ts): drives renderer flows (chat → agent, answering, forms, refreshing) without
 * clicks. Present in dev, and in a build only when main opened the page as `index.html#smoke`
 * (main does that only with CORTEX_SMOKE=1).
 */
import { openAdd, sendPrompt } from './actions';
import { chooseOption } from './kinds/agent/session';
import { actionsForItem } from './kinds/registry';
import { addItem, addLink, getState, inspect, itemById, replaceWorld, select } from './store';
import { refreshDue } from './sync';
import { formDriver } from './ui/form';
import { loadDemoWorld, resetToDemo } from './persist';

declare global {
  interface Window {
    __cortexDebug?: Record<string, unknown>;
  }
}

/** Run one of an item's actions by id (what a click in the action list does). */
function runAction(id: string, actionId: string) {
  const item = itemById(id);
  const action = item && actionsForItem(item).find((a) => a.id === actionId);
  if (!item || !action) throw new Error(`no action ${actionId} on ${id}`);
  if (action.disabled) throw new Error(`action ${actionId} is disabled: ${action.disabled}`);
  action.run([item]);
}

/** Mount the viewer gallery (markdown + mermaid, diff, CodeMirror, log, webview) over the app: CSP / render check. */
async function showGallery() {
  const [{ createRoot }, { ViewerGallery }, { createElement }, { AppRoot }] = await Promise.all([
    import('react-dom/client'),
    import('./components/viewers/Gallery'),
    import('react'),
    import('@dynatrace/strato-components/core'),
  ]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:1000;';
  document.body.appendChild(host);
  createRoot(host).render(createElement(AppRoot, null, createElement(ViewerGallery)));
}

if (import.meta.env.DEV || location.hash === '#smoke')
  window.__cortexDebug = { getState, itemById, addItem, addLink, sendPrompt, chooseOption, refreshDue, inspect, select, runAction, forms: formDriver, showGallery, openAdd, replaceWorld, resetToDemo, loadDemoWorld };
