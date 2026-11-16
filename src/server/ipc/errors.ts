import { encodeIpcError, type IpcErrorPayload } from '../../shared/ipcError';
import { CliMissingError } from '../lib/exec';
import { InvalidRequestError } from '../lib/validate';
import { PathNotAllowedError } from '../lib/pathPolicy';
import { CliError, ParseError } from '../services/cli';

/** Classify any thrown value for the renderer. */
export function toIpcError(err: unknown): IpcErrorPayload {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof PathNotAllowedError) return { code: 'FORBIDDEN', message };
  if (err instanceof CliMissingError) return { code: 'CLI_MISSING', message };
  if (err instanceof CliError) {
    const base = { message, stderr: err.stderr || undefined };
    return err.timedOut ? { code: 'TIMEOUT', ...base } : { code: 'EXIT', exitCode: err.code, ...base };
  }
  if (err instanceof ParseError) return { code: 'PARSE', message };
  if (err instanceof InvalidRequestError) return { code: 'VALIDATION', message, issues: err.issues };
  return { code: 'UNKNOWN', message };
}

/** An Error whose message is the encoded payload (what the renderer's transport rethrows). */
export const ipcError = (err: unknown): Error => new Error(encodeIpcError(toIpcError(err)));
