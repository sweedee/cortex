import { describe, expect, it } from 'vitest';
import { decodeIpcError, encodeIpcError, ipcErrorCode, ipcErrorMessage } from './ipcError';

describe('ipc errors', () => {
  it("round-trips a payload, also through Electron's wrapper", () => {
    const p = { code: 'EXIT', message: 'gh pr view: nope', stderr: 'boom', exitCode: 4 } as const;
    const wrapped = new Error(`Error invoking remote method 'gh:prView': Error: ${encodeIpcError(p)}`);
    expect(decodeIpcError(wrapped)).toEqual(p);
    expect(ipcErrorCode(wrapped)).toBe('EXIT');
    expect(ipcErrorMessage(wrapped)).toBe('gh pr view: nope');
  });
  it('treats anything else as plain text', () => {
    expect(decodeIpcError(new Error('x'))).toBeNull();
    expect(decodeIpcError(new Error('@@cortex-error@@{bad'))).toBeNull();
    expect(decodeIpcError(new Error(`@@cortex-error@@${JSON.stringify({ code: 'NOPE', message: 'm' })}`))).toBeNull();
    expect(ipcErrorCode('x')).toBe('UNKNOWN');
    expect(ipcErrorMessage(new Error("Error invoking remote method 'a': Error: Boom"))).toBe('Boom');
  });
});
