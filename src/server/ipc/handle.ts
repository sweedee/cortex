import type { EventChannel, EventChannels, InvokeChannel, Req, Res } from '../../shared/ipc';
import { INVOKE_CHANNELS } from '../../shared/ipc';
import type { IpcErrorPayload } from '../../shared/ipcError';
import { parseRequest } from '../lib/validate';
import { toIpcError } from './errors';

/** Who made a call: the browser tab's client id (`X-Cortex-Client`, also used by its event socket). */
export interface Caller {
  clientId?: string;
}

/** Shared state the handler modules need. */
export interface IpcContext {
  /** push an event to every connected client (no-op when none is connected) */
  send<C extends EventChannel>(channel: C, payload: EventChannels[C]): void;
  /** where handlers are registered; the HTTP router dispatches through it */
  registry: Registry;
}

type Handler = (req: unknown, caller: Caller) => unknown;

/** The outcome of one call: the response, or the structured error the renderer decodes. */
export type InvokeOutcome = { ok: true; value: unknown } | { ok: false; error: IpcErrorPayload };

const declared = new Set<string>(INVOKE_CHANNELS);

/** channel → handler. Only channels declared in `shared/ipc.ts` can be registered or called. */
export class Registry {
  private readonly handlers = new Map<string, Handler>();

  set(channel: InvokeChannel, fn: Handler): void {
    if (!declared.has(channel)) throw new Error(`${channel} is not a declared invoke channel`);
    if (this.handlers.has(channel)) throw new Error(`${channel} has two handlers`);
    this.handlers.set(channel, fn);
  }

  has(channel: string): channel is InvokeChannel {
    return declared.has(channel) && this.handlers.has(channel);
  }

  /** every declared channel without a handler (the server checks this at start) */
  missing(): InvokeChannel[] {
    return INVOKE_CHANNELS.filter((c) => !this.handlers.has(c));
  }

  /** Validate `raw` against the channel's schema, run the handler, classify any error. */
  async invoke(channel: InvokeChannel, raw: unknown, caller: Caller = {}): Promise<InvokeOutcome> {
    const fn = this.handlers.get(channel);
    if (!fn) return { ok: false, error: { code: 'UNKNOWN', message: `${channel}: no handler` } };
    try {
      return { ok: true, value: await fn(parseRequest(channel, raw), caller) };
    } catch (err) {
      return { ok: false, error: toIpcError(err) };
    }
  }
}

/** Register a typed, validated invoke handler. */
export function handle<C extends InvokeChannel>(ctx: IpcContext, channel: C, fn: (req: Req<C>, caller: Caller) => Res<C> | Promise<Res<C>>): void {
  ctx.registry.set(channel, fn as Handler);
}
