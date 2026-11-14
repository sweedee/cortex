/**
 * Dev-only handle for the headless smoke probe (`CORTEX_SMOKE=1 CORTEX_SMOKE_E2E=1 npm run dev`,
 * src/main/smoke.ts): drives renderer flows (chat → agent, answering, refreshing) without clicks.
 * Not present in production builds.
 */
import { sendPrompt } from './actions';
import { chooseOption } from './kinds/agent/session';
import { addItem, addLink, getState, itemById } from './store';
import { refreshDue } from './sync';

declare global {
  interface Window {
    __cortexDebug?: Record<string, unknown>;
  }
}

if (import.meta.env.DEV) window.__cortexDebug = { getState, itemById, addItem, addLink, sendPrompt, chooseOption, refreshDue };
