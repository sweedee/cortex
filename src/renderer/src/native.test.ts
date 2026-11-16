import { describe, expect, it, vi } from 'vitest';
import { eventChannels, invokeChannels } from '../../shared/ipc';
import { decodeIpcError } from '../../shared/ipcError';
import { browserFallback, browserFallbacks, serverTransport } from './native';

describe('test fallback', () => {
  it('says what every channel does without the server', () => {
    const f = browserFallbacks();
    expect(Object.keys(f.invoke).sort()).toEqual(Object.keys(invokeChannels).sort());
    expect(Object.keys(f.events).sort()).toEqual(Object.keys(eventChannels).sort());
  });

  it('rejects server-only channels and answers the rest', async () => {
    const api = browserFallback();
    await expect(api.gh.prView({ repo: 'o/r', number: 1 })).rejects.toThrow(/gh:prView needs the Cortex server/);
    expect(await api.claude.list()).toEqual([]);
    await expect(api.dialog.listDir()).rejects.toThrow(/needs the Cortex server/);
    expect(typeof api.fs.onChanged(() => {})).toBe('function');
  });
});

describe('server transport', () => {
  it('posts JSON, rethrows the server error payload in the shape decodeIpcError reads, and routes events', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const replies: Response[] = [
      new Response('[1]', { status: 200 }),
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ error: { code: 'EXIT', message: 'gh pr view: nope', exitCode: 1 } }), { status: 500 }),
      new Response('nope', { status: 401 }),
    ];
    const sockets: { url: string; onmessage?: (e: { data: string }) => void }[] = [];
    class FakeSocket {
      url: string;
      onmessage?: (e: { data: string }) => void;
      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }
    }
    vi.stubGlobal('location', { protocol: 'http:', host: '127.0.0.1:4317' });
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => (calls.push({ url, init }), replies.shift()!));
    try {
      const { api } = serverTransport();
      expect(await api.proc.list()).toEqual([1]);
      expect(calls[0]!.url).toBe('/api/invoke/proc%3Alist');
      expect(calls[0]!.init.body).toBeUndefined();
      expect(await api.workspace.save({ data: { a: 1 } })).toBeUndefined();
      expect(calls[1]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"data":{"a":1}}' });
      const err = await api.gh.prView({ repo: 'o/r', number: 1 }).catch((e: unknown) => e);
      expect(decodeIpcError(err)).toMatchObject({ code: 'EXIT', exitCode: 1, message: 'gh pr view: nope' });
      expect(decodeIpcError(await api.proc.list().catch((e: unknown) => e))?.code).toBe('FORBIDDEN');

      expect(sockets[0]!.url).toMatch(/^ws:\/\/127\.0\.0\.1:4317\/api\/events\?client=/);
      const got: unknown[] = [];
      const off = api.proc.onExit((p) => got.push(p));
      sockets[0]!.onmessage!({ data: JSON.stringify({ channel: 'proc:exit', payload: { id: 'x' } }) });
      sockets[0]!.onmessage!({ data: JSON.stringify({ channel: 'proc:output', payload: { id: 'y' } }) });
      off();
      sockets[0]!.onmessage!({ data: JSON.stringify({ channel: 'proc:exit', payload: { id: 'z' } }) });
      expect(got).toEqual([{ id: 'x' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
