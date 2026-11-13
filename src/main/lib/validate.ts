import { z } from 'zod';
import type { InvokeChannel, Req } from '../../shared/ipc';
import { schemas } from '../../shared/schemas';

/** Validate an incoming IPC request against its channel's zod schema; throws a readable error. */
export function parseRequest<C extends InvokeChannel>(channel: C, raw: unknown): Req<C> {
  const r = schemas[channel].safeParse(raw);
  if (!r.success) throw new Error(`Invalid ${channel} request:\n${z.prettifyError(r.error)}`);
  return r.data as Req<C>;
}
