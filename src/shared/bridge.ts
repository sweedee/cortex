/**
 * Builds the `CortexApi` object from the channel lists in `./ipc.ts`: `gh:prEdit` →
 * `api.gh.prEdit(req)`, `proc:exit` → `api.proc.onExit(cb)`, plus the generic `api.on(channel, cb)`.
 * `renderer/src/native.ts` builds the HTTP / WebSocket transport and the unit-test fallback with it.
 * Dependency free.
 */
import { EVENT_CHANNELS, INVOKE_CHANNELS, type CortexApi, type EventChannel, type EventChannels, type InvokeChannel, type Unsubscribe } from './ipc';

export type BridgeInvoke = (channel: InvokeChannel, req: unknown) => Promise<unknown>;
export type BridgeOn = <C extends EventChannel>(channel: C, cb: (payload: EventChannels[C]) => void) => Unsubscribe;

const split = (channel: string): [string, string] => {
  const i = channel.indexOf(':');
  return [channel.slice(0, i), channel.slice(i + 1)];
};

/** `invoke` is only ever called with a declared channel; `on` only with a declared event channel. */
export function buildBridge(invoke: BridgeInvoke, on: BridgeOn): CortexApi {
  const groups: Record<string, Record<string, unknown>> = {};
  const group = (name: string) => (groups[name] ??= {});
  for (const channel of INVOKE_CHANNELS) {
    const [g, method] = split(channel);
    group(g)[method] = (req?: unknown) => invoke(channel, req);
  }
  for (const channel of EVENT_CHANNELS) {
    const [g, name] = split(channel);
    group(g)[`on${name[0]!.toUpperCase()}${name.slice(1)}`] = (cb: (payload: EventChannels[EventChannel]) => void) => on(channel, cb);
  }
  const anyEvent = <C extends EventChannel>(channel: C, cb: (payload: EventChannels[C]) => void): Unsubscribe => {
    // only declared event channels
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Unknown event channel "${channel}"`);
    return on(channel, cb);
  };
  return { ...groups, on: anyEvent } as unknown as CortexApi;
}
