/**
 * The HTTP + WebSocket front of the server:
 *
 *   POST /api/invoke/<channel>   JSON request body → 200 JSON response (204 for none), or
 *                                `{ error: IpcErrorPayload }` with 400 / 403 / 404 / 500
 *   GET  /api/events             WebSocket; the server sends `{ channel, payload }` text frames
 *   GET  /?token=<token>         sets the auth cookie and redirects to the same URL without the token
 *   GET  anything else           the built renderer (production), or 404 when there is none (dev: Vite)
 *
 * Every request passes the checks in `security.ts` (Host, Origin, token) first.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { EventChannel, EventChannels } from '../../shared/ipc';
import type { IpcErrorPayload } from '../../shared/ipcError';
import type { Registry } from '../ipc/handle';
import { cspProd } from './csp';
import { authCookie, hostAllowed, isAuthenticated, originAllowed, tokenMatches, type SecurityConfig } from './security';
import { findStatic, sendFile } from './static';

export interface AppOptions {
  registry: Registry;
  security: SecurityConfig;
  /** the built renderer (`out/renderer`); none in dev, where Vite serves the page */
  staticRoot?: string;
  /** dev: after `/?token=…` redirect to the Vite dev server instead of this server's `/` */
  devUrl?: string;
  /** max request body (bytes) */
  bodyLimit?: number;
  /** a browser tab's event socket is gone and did not come back within `clientGraceMs` */
  onClientGone?: (clientId: string) => void;
  clientGraceMs?: number;
  log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void };
}

export interface CortexServer {
  server: Server;
  /** push an event to every connected tab */
  broadcast<C extends EventChannel>(channel: C, payload: EventChannels[C]): void;
  /** connected event sockets */
  clients(): number;
  close(): Promise<void>;
}

const DEFAULT_BODY_LIMIT = 32 * 1024 * 1024;
/** a socket that buffers more than this is not keeping up: drop its events rather than grow forever */
const MAX_BUFFERED = 64 * 1024 * 1024;
const CLIENT_ID = /^[\w-]{1,64}$/;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const STATUS: Record<IpcErrorPayload['code'], number> = { VALIDATION: 400, FORBIDDEN: 403, CLI_MISSING: 500, TIMEOUT: 500, EXIT: 500, PARSE: 500, UNKNOWN: 500 };

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) return void res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const sendError = (res: ServerResponse, status: number, error: IpcErrorPayload) => sendJson(res, status, { error });

function sendText(res: ServerResponse, status: number, text: string) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new BodyTooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Host / Origin checks shared by requests and upgrades; the reason when refused */
function refusal(req: IncomingMessage, cfg: SecurityConfig): string | undefined {
  if (!hostAllowed(req.headers.host, cfg)) return 'bad Host header';
  const origin = req.headers.origin;
  if (!originAllowed(typeof origin === 'string' ? origin : undefined, cfg)) return 'origin not allowed';
  return undefined;
}

export function createCortexServer(opts: AppOptions): CortexServer {
  const { registry, security: cfg } = opts;
  const limit = opts.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const grace = opts.clientGraceMs ?? 10_000;
  const log = opts.log ?? console;
  const sockets = new Map<WebSocket, string | undefined>();
  const goneTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function onInvoke(req: IncomingMessage, res: ServerResponse, channel: string) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendError(res, 405, { code: 'VALIDATION', message: `${req.method} not allowed` });
    }
    if (!registry.has(channel)) return sendError(res, 404, { code: 'UNKNOWN', message: `Unknown channel "${channel.slice(0, 100)}"` });
    const type = req.headers['content-type'] ?? '';
    let raw: unknown;
    try {
      const text = await readBody(req, limit);
      if (text.length) {
        // JSON only: a cross-site form can't send it without a CORS preflight (which nothing answers)
        if (!/^application\/json\b/i.test(type)) return sendError(res, 415, { code: 'VALIDATION', message: 'Content-Type must be application/json' });
        raw = JSON.parse(text);
      }
    } catch (e) {
      if (e instanceof BodyTooLarge) return sendError(res, 413, { code: 'VALIDATION', message: `Request body over ${limit} bytes` });
      return sendError(res, 400, { code: 'VALIDATION', message: 'Request body is not valid JSON' });
    }
    const clientHeader = req.headers['x-cortex-client'];
    const clientId = typeof clientHeader === 'string' && CLIENT_ID.test(clientHeader) ? clientHeader : undefined;
    const out = await registry.invoke(channel, raw, { clientId });
    if (out.ok) sendJson(res, out.value === undefined ? 204 : 200, out.value);
    else sendError(res, STATUS[out.error.code], out.error);
  }

  async function onRequest(req: IncomingMessage, res: ServerResponse) {
    const why = refusal(req, cfg);
    if (why) return sendText(res, why === 'bad Host header' ? 421 : 403, `Forbidden: ${why}`);
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // log-in: the token from the URL the server printed → cookie, then strip it from the address bar
    const given = url.searchParams.get('token');
    if (given !== null && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
      if (!tokenMatches(given, cfg.token)) return sendText(res, 401, 'Invalid token. Open the URL the Cortex server printed when it started.');
      url.searchParams.delete('token');
      res.statusCode = 303;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      res.setHeader('Set-Cookie', authCookie(cfg));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Location', opts.devUrl ?? `${url.pathname}${url.search}${url.hash}`);
      return void res.end();
    }

    if (!isAuthenticated(req, cfg)) {
      if (url.pathname.startsWith('/api/')) return sendError(res, 401, { code: 'FORBIDDEN', message: 'Not authenticated: open the URL the Cortex server printed' });
      return sendText(res, 401, 'Not authenticated. Open the URL the Cortex server printed when it started (http://127.0.0.1:PORT/?token=…).'.replace('PORT', String(cfg.port)));
    }

    if (url.pathname.startsWith('/api/')) {
      // no cross-site API calls even with a cookie (SameSite=Strict already keeps it out of them)
      if (req.headers['sec-fetch-site'] === 'cross-site') return sendError(res, 403, { code: 'FORBIDDEN', message: 'cross-site request' });
      const m = /^\/api\/invoke\/([^/]+)$/.exec(url.pathname);
      if (m) {
        let channel: string;
        try {
          channel = decodeURIComponent(m[1]!);
        } catch {
          return sendError(res, 404, { code: 'UNKNOWN', message: 'Unknown channel' });
        }
        return onInvoke(req, res, channel);
      }
      return sendError(res, 404, { code: 'UNKNOWN', message: 'Not found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    if (!opts.staticRoot) return sendText(res, 404, 'No renderer build here: in development the page is served by Vite.');
    const found = await findStatic(opts.staticRoot, url.pathname);
    if (!found) return sendText(res, 404, 'Not found');
    sendFile(res, found, found.html ? { ...SECURITY_HEADERS, 'Content-Security-Policy': cspProd() } : SECURITY_HEADERS, req.method === 'HEAD');
  }

  const server = createServer((req, res) => {
    onRequest(req, res).catch((e: unknown) => {
      log.warn('[http] request failed', e);
      if (!res.headersSent) sendError(res, 500, { code: 'UNKNOWN', message: 'Internal error' });
      else res.destroy();
    });
  });
  server.requestTimeout = 0; // long-running invokes (git fetch, gh, claude) may take minutes
  server.headersTimeout = 30_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const reject = (socket: Duplex, status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  server.on('upgrade', (req, socket, head) => {
    const why = refusal(req, cfg);
    if (why) return reject(socket, 403, 'Forbidden');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/api/events') return reject(socket, 404, 'Not Found');
    if (!isAuthenticated(req, cfg)) return reject(socket, 401, 'Unauthorized');
    const client = url.searchParams.get('client');
    const clientId = client && CLIENT_ID.test(client) ? client : undefined;
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, clientId);
      if (clientId) {
        clearTimeout(goneTimers.get(clientId));
        goneTimers.delete(clientId);
      }
      let alive = true;
      ws.on('pong', () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 30_000);
      ws.on('message', () => {}); // nothing to receive; the socket is one-way
      ws.on('error', () => ws.terminate());
      ws.on('close', () => {
        clearInterval(ping);
        sockets.delete(ws);
        if (!clientId || [...sockets.values()].includes(clientId)) return;
        // a reconnect (server busy, laptop asleep) keeps the tab's watches; a reload / closed tab doesn't come back
        goneTimers.set(
          clientId,
          setTimeout(() => {
            goneTimers.delete(clientId);
            if (![...sockets.values()].includes(clientId)) opts.onClientGone?.(clientId);
          }, grace),
        );
      });
    });
  });

  return {
    server,
    broadcast(channel, payload) {
      if (!sockets.size) return;
      const text = JSON.stringify({ channel, payload });
      for (const ws of sockets.keys()) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (ws.bufferedAmount > MAX_BUFFERED) {
          log.warn(`[ws] client not keeping up, dropped ${channel}`);
          continue;
        }
        ws.send(text);
      }
    },
    clients: () => sockets.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of goneTimers.values()) clearTimeout(t);
        for (const ws of sockets.keys()) ws.terminate();
        wss.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
