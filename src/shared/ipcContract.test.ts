import { describe, expect, it, vi } from 'vitest';
import { buildBridge } from './bridge';
import { EVENT_CHANNELS, INVOKE_CHANNELS, eventChannels, invokeChannels } from './ipc';
import { schemas } from './schemas';

const sorted = (xs: Iterable<string>) => [...xs].sort();

/** Call every method the bridge exposes and record which channel each one reached. */
function exposure() {
  const invoked: string[] = [];
  const subscribed: string[] = [];
  const api = buildBridge(
    async (channel) => void invoked.push(channel),
    (channel) => {
      subscribed.push(channel);
      return () => {};
    },
  ) as unknown as Record<string, unknown>;
  for (const [group, methods] of Object.entries(api)) {
    if (group === 'on') continue;
    for (const [name, fn] of Object.entries(methods as Record<string, (arg?: unknown) => unknown>)) {
      if (/^on[A-Z]/.test(name)) fn(() => {});
      else void fn({});
    }
  }
  return { api, invoked, subscribed };
}

describe('IPC contract', () => {
  it('the schema map, the channel map and the preload bridge cover exactly the same invoke channels', () => {
    const declared = sorted(Object.keys(invokeChannels));
    expect(sorted(INVOKE_CHANNELS)).toEqual(declared);
    expect(sorted(Object.keys(schemas))).toEqual(declared);
    expect(sorted(exposure().invoked)).toEqual(declared);
  });

  it('the bridge exposes exactly the declared event channels, as on<Event> and through on()', () => {
    const { api, subscribed } = exposure();
    expect(sorted(subscribed)).toEqual(sorted(Object.keys(eventChannels)));
    expect(sorted(EVENT_CHANNELS)).toEqual(sorted(Object.keys(eventChannels)));
    const on = api['on'] as (c: string, cb: () => void) => () => void;
    expect(() => on('nope', () => {})).toThrow(/Unknown event channel/);
    expect(() => on('proc:exit', () => {})).not.toThrow();
  });

  it('maps `group:method` to api.group.method(req) and passes the request through', async () => {
    const invoke = vi.fn<(channel: string, req: unknown) => Promise<unknown>>(async () => 'ok');
    const api = buildBridge(invoke, () => () => {});
    await api.gh.prEdit({ repo: 'o/r', number: 1, base: 'main' });
    await api.app.info();
    expect(invoke.mock.calls).toEqual([
      ['gh:prEdit', { repo: 'o/r', number: 1, base: 'main' }],
      ['app:info', undefined],
    ]);
  });

  it('all-optional and void requests accept a missing request', () => {
    expect(schemas['dialog:pickDirectory'].parse(undefined)).toEqual({});
    expect(schemas['app:info'].safeParse(undefined).success).toBe(true);
  });
});
