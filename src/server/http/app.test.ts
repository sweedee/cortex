import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { decodeIpcError, encodeIpcError } from '../../shared/ipcError';
import { handle, Registry, type IpcContext } from '../ipc/handle';
import { CliError } from '../services/cli';
import { createCortexServer, type CortexServer } from './app';
import { cookieName } from './security';

const TOKEN = 'test-token-0123456789abcdef';
let app: CortexServer;
let port = 0;
let root: string;
const gone: string[] = [];

/** raw request: full control over Host / Origin / cookies (fetch can't set Host) */
function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}
const auth = { authorization: `Bearer ${TOKEN}` };
const json = (body: unknown) => ({ headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const invoke = (channel: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `/api/invoke/${channel}`, body === undefined ? { headers: { ...auth, ...headers } } : { ...json(body), headers: { ...json(body).headers, ...headers } });

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cortex-app-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>cortex</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, '.secret'), 'no');
  writeFileSync(join(tmpdir(), 'cortex-outside.txt'), 'outside');
  const registry = new Registry();
  const ctx: IpcContext = { registry, send: () => {} };
  handle(ctx, 'proc:list', () => []);
  handle(ctx, 'proc:stop', ({ id }) => {
    if (id === 'boom') throw new CliError('git', ['fetch'], { code: 128, stdout: '', stderr: 'fatal: nope', timedOut: false });
    return true;
  });
  handle(ctx, 'workspace:save', () => {});
  handle(ctx, 'fs:unwatch', (_req, caller) => void gone.push(`caller:${caller.clientId}`));
  // port 0 → find the real one, then bind the security config to it
  const probe = createCortexServer({ registry, security: { port: 1, token: TOKEN } });
  await new Promise<void>((r) => probe.server.listen(0, '127.0.0.1', r));
  port = (probe.server.address() as AddressInfo).port;
  await probe.close();
  app = createCortexServer({
    registry,
    security: { port, token: TOKEN, devOrigins: ['http://127.0.0.1:5173'] },
    staticRoot: root,
    onClientGone: (id) => gone.push(id),
    clientGraceMs: 20,
    log: { info() {}, warn() {} },
  });
  await new Promise<void>((r) => app.server.listen(port, '127.0.0.1', r));
});

afterAll(async () => {
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('auth', () => {
  it('requires the token for /api and the page', async () => {
    const r = await call('POST', '/api/invoke/proc:list');
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).error.code).toBe('FORBIDDEN');
    expect((await call('GET', '/')).status).toBe(401);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { authorization: 'Bearer wrong-token-0123456789abc' } })).status).toBe(401);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { cookie: `${cookieName(port)}=nope` } })).status).toBe(401);
  });

  it('?token= sets an HttpOnly SameSite=Strict cookie and redirects without it; the cookie then works', async () => {
    const r = await call('GET', `/canvas?x=1&token=${TOKEN}`);
    expect(r.status).toBe(303);
    expect(r.headers['location']).toBe('/canvas?x=1');
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${cookieName(port)}=`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const pair = cookie.split(';')[0]!;
    expect((await call('POST', '/api/invoke/proc:list', { headers: { cookie: pair } })).body).toBe('[]');
    expect((await call('GET', '/?token=wrong')).status).toBe(401);
  });

  it('rejects a foreign Host (DNS rebinding) and a foreign Origin', async () => {
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, host: `evil.example:${port}` } })).status).toBe(421);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, host: '127.0.0.1:1' } })).status).toBe(421);
    expect((await call('GET', `/?token=${TOKEN}`, { headers: { host: `attacker.test:${port}` } })).status).toBe(421);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, origin: `http://localhost:${port}` } })).status).toBe(200);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, origin: 'http://127.0.0.1:5173' } })).status).toBe(200);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, host: `localhost:${port}` } })).status).toBe(200);
    expect((await call('POST', '/api/invoke/proc:list', { headers: { ...auth, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  });
});

describe('invoke', () => {
  it('passes results through (204 for none)', async () => {
    expect(await invoke('proc:stop', { id: 'a' })).toMatchObject({ status: 200, body: 'true' });
    expect((await invoke('workspace:save', { data: { a: 1 } })).status).toBe(204);
  });

  it('only routes declared channels with a handler', async () => {
    expect((await invoke('nope:nothing', {})).status).toBe(404);
    expect((await invoke('git:status', { dir: '/x' })).status).toBe(404); // declared, but no handler here
    expect((await call('GET', '/api/invoke/proc:list', { headers: auth })).status).toBe(405);
    expect((await call('GET', '/api/other', { headers: auth })).status).toBe(404);
  });

  it('answers errors with the IPC error payload the renderer decodes', async () => {
    const bad = await invoke('proc:stop', { id: 1 });
    expect(bad.status).toBe(400);
    const v = JSON.parse(bad.body).error;
    expect(v).toMatchObject({ code: 'VALIDATION' });
    expect(v.issues[0]).toMatchObject({ path: 'id' });
    expect(decodeIpcError(new Error(encodeIpcError(v)))).toEqual(v);
    const exit = await invoke('proc:stop', { id: 'boom' });
    expect(exit.status).toBe(500);
    expect(JSON.parse(exit.body).error).toMatchObject({ code: 'EXIT', exitCode: 128, stderr: 'fatal: nope' });
    expect((await invoke('proc:list', { evil: true })).status).toBe(400);
  });

  it('wants JSON and limits the body', async () => {
    expect((await call('POST', '/api/invoke/proc:stop', { headers: { ...auth, 'content-type': 'text/plain' }, body: '{"id":"a"}' })).status).toBe(415);
    expect((await call('POST', '/api/invoke/proc:stop', { headers: { ...auth, 'content-type': 'application/json' }, body: '{bad' })).status).toBe(400);
    const big = await call('POST', '/api/invoke/workspace:save', { ...json({ data: 'x'.repeat(33 * 1024 * 1024) }) }).catch(() => ({ status: 413 }));
    expect(big.status).toBe(413);
  });

  it('passes the X-Cortex-Client id to the handler', async () => {
    await invoke('fs:unwatch', { watchId: 'w1' }, { 'x-cortex-client': 'tab-1' });
    expect(gone).toContain('caller:tab-1');
  });
});

describe('static files', () => {
  it('serves the page with the CSP, assets by MIME type, the SPA fallback, and nothing outside the root', async () => {
    const page = await call('GET', '/', { headers: auth });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(page.headers['content-security-policy']).toMatch(/frame-src http:\/\/localhost:\*/);
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    const js = await call('GET', '/assets/app.js', { headers: auth });
    expect(js.headers['content-type']).toMatch(/text\/javascript/);
    expect(js.headers['content-security-policy']).toBeUndefined();
    expect((await call('GET', '/some/route', { headers: auth })).body).toMatch(/<title>cortex/);
    expect((await call('GET', '/assets/missing.js', { headers: auth })).status).toBe(404);
    for (const p of ['/../cortex-outside.txt', '/%2e%2e/cortex-outside.txt', '/assets/..%2f..%2fcortex-outside.txt', '/.secret', '/%00']) {
      const r = await call('GET', p, { headers: auth });
      expect(r.body, p).not.toMatch(/outside|^no$/);
    }
  });
});

describe('events socket', () => {
  const open = (headers: Record<string, string>, client = 'tab-ws') =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events?client=${client}`, { headers });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });

  it('needs the token and an allowed Origin', async () => {
    await expect(open({})).rejects.toThrow(/401/);
    await expect(open({ ...auth, origin: 'https://evil.example' })).rejects.toThrow(/403/);
    await expect(open({ ...auth, host: `evil.example:${port}` })).rejects.toThrow(/403/);
  });

  it('broadcasts {channel, payload} and reports a tab that is gone for good', async () => {
    const ws = await open({ ...auth, origin: `http://127.0.0.1:${port}` });
    const got = new Promise<unknown>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
    app.broadcast('proc:exit', { id: 'p', code: 0, signal: null });
    expect(await got).toEqual({ channel: 'proc:exit', payload: { id: 'p', code: 0, signal: null } });
    expect(app.clients()).toBe(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(gone).toContain('tab-ws');
    expect(app.clients()).toBe(0);
  });
});
