/**
 * Dev-only handle for the headless smoke probe (`CORTEX_SMOKE=1 CORTEX_SMOKE_E2E=1 npm run dev`,
 * src/main/smoke.ts): drives renderer flows (chat → agent, answering, refreshing) without clicks.
 * Not present in production builds.
 */
import { sendPrompt } from './actions';
import { chooseOption } from './kinds/agent/session';
import { actionsForItem } from './kinds/registry';
import { addItem, addLink, getState, inspect, itemById, select } from './store';
import { refreshDue } from './sync';

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

if (import.meta.env.DEV) window.__cortexDebug = { getState, itemById, addItem, addLink, sendPrompt, chooseOption, refreshDue, inspect, select, runAction };
