import { z } from 'zod';
import type { InvokeChannel, Req } from '../../shared/ipc';
import { schemas } from '../../shared/schemas';

/** An IPC request that does not match its channel's schema. */
export class InvalidRequestError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(message: string, issues: { path: string; message: string }[]) {
    super(message);
    this.name = 'InvalidRequestError';
    this.issues = issues;
  }
}

/** Validate an incoming IPC request against its channel's zod schema; throws a readable error. */
export function parseRequest<C extends InvokeChannel>(channel: C, raw: unknown): Req<C> {
  const r = schemas[channel].safeParse(raw);
  if (!r.success)
    throw new InvalidRequestError(
      `Invalid ${channel} request:\n${z.prettifyError(r.error)}`,
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return r.data as Req<C>;
}
