import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeIpcError } from '../../shared/ipcError';

const handlers = new Map<string, (e: unknown, raw: unknown) => Promise<unknown>>();
vi.mock('electron', () => ({ ipcMain: { handle: (c: string, fn: never) => handlers.set(c, fn) } }));

const { handle } = await import('./handle');
const { CliError } = await import('../services/cli');

const frame = { processId: 1, routingId: 2 };
const wc = { mainFrame: frame };
const ctx = { getWindow: () => ({ webContents: wc }) as never, send: () => {} };
const call = (channel: string, raw: unknown) => handlers.get(channel)!({ sender: wc, senderFrame: frame }, raw);

beforeEach(() => handlers.clear());

describe('handle() error mapping', () => {
  it('passes results through', async () => {
    handle(ctx, 'proc:list', () => []);
    expect(await call('proc:list', undefined)).toEqual([]);
  });
  it('encodes CliError, validation and policy errors', async () => {
    handle(ctx, 'proc:stop', () => {
      throw new CliError('git', ['fetch'], { code: 128, stdout: '', stderr: 'fatal: nope', timedOut: false });
    });
    const exit = await call('proc:stop', { id: 'a' }).catch((e: unknown) => decodeIpcError(e));
    expect(exit).toMatchObject({ code: 'EXIT', exitCode: 128, stderr: 'fatal: nope' });
    const bad = (await call('proc:stop', { id: 1 }).catch((e: unknown) => decodeIpcError(e))) as { code: string };
    expect(bad.code).toBe('VALIDATION');
  });
  it('refuses foreign callers as FORBIDDEN', async () => {
    handle(ctx, 'proc:list', () => []);
    const r = (await handlers.get('proc:list')!({ sender: {}, senderFrame: frame }, undefined).catch((e: unknown) => decodeIpcError(e))) as { code: string };
    expect(r.code).toBe('FORBIDDEN');
  });
});
