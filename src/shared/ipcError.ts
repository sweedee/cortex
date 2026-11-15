/**
 * Structured errors across the IPC boundary. Electron flattens a rejected `ipcMain.handle` into
 * `Error invoking remote method 'x': Error: <message>`, losing everything but the text. So main
 * throws an Error whose message is `PREFIX + JSON(payload)`; the renderer decodes it again with
 * `decodeIpcError` (and falls back to the plain text for anything else).
 */
export type IpcErrorCode = 'CLI_MISSING' | 'TIMEOUT' | 'EXIT' | 'PARSE' | 'VALIDATION' | 'FORBIDDEN' | 'UNKNOWN';

export interface IpcErrorPayload {
  code: IpcErrorCode;
  /** human-readable, safe to show */
  message: string;
  stderr?: string;
  /** the process exit code (code EXIT) */
  exitCode?: number | null;
  /** zod issues (code VALIDATION) */
  issues?: { path: string; message: string }[];
}

export const IPC_ERROR_PREFIX = '@@cortex-error@@';

/** The message of the Error main throws. */
export const encodeIpcError = (p: IpcErrorPayload): string => IPC_ERROR_PREFIX + JSON.stringify(p);

const CODES: readonly string[] = ['CLI_MISSING', 'TIMEOUT', 'EXIT', 'PARSE', 'VALIDATION', 'FORBIDDEN', 'UNKNOWN'];

/** The payload inside an error (or message string) that came through IPC; null when it is not one of ours. */
export function decodeIpcError(e: unknown): IpcErrorPayload | null {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const i = text.indexOf(IPC_ERROR_PREFIX);
  if (i < 0) return null;
  try {
    const p = JSON.parse(text.slice(i + IPC_ERROR_PREFIX.length)) as IpcErrorPayload;
    return p && typeof p.message === 'string' && CODES.includes(p.code) ? p : null;
  } catch {
    return null;
  }
}

/** The code of an IPC error, 'UNKNOWN' for anything else. */
export const ipcErrorCode = (e: unknown): IpcErrorCode => decodeIpcError(e)?.code ?? 'UNKNOWN';

/** A readable message of any failed native call: the structured message when there is one, else the text without Electron's "Error invoking remote method …" wrapper. */
export function ipcErrorMessage(e: unknown): string {
  const p = decodeIpcError(e);
  if (p) return p.message;
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': /, '').replace(/^(?:(?:[A-Z]\w*)?Error: )+/, '');
}
