/**
 * Cortex server: the IPC handlers in `./ipc` behind a local HTTP + WebSocket API (`./http/app.ts`),
 * plus the built renderer in production. Listens on 127.0.0.1 only; prints the URL with the per-start
 * token. Env: PORT (default 4317), CORTEX_TOKEN (fixed token, ≥ 16 chars; `npm run dev` sets one),
 * CORTEX_USER_DATA, CORTEX_ALLOW_UNATTENDED; dev only: CORTEX_DEV_ORIGIN, CORTEX_DEV_URL.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCortexServer } from './http/app';
import { makeToken, parseOrigins } from './http/security';
import { Registry, registerIpc } from './ipc';
import { stripDevEnv } from './lib/devEnv';
import { initLog, installCrashHandlers, log } from './lib/log';
import { appVersion, findAppRoot, isProduction } from './lib/runtime';
import { resolveUserData } from './lib/userData';

const production = isProduction();
// dev / test overrides (CORTEX_CLAUDE_BIN, CORTEX_DEV_ORIGIN, …) don't work in production
const ignoredDevEnv = stripDevEnv(process.env, production);

const userData = resolveUserData(process.env);
initLog(join(userData, 'logs'));
installCrashHandlers();
if (ignoredDevEnv.length) log.warn(`[cortex] ignoring dev-only env in production: ${ignoredDevEnv.join(', ')}`);

const appRoot = findAppRoot();
const port = Number(process.env['PORT'] || 4317);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT must be a port number, got ${process.env['PORT']}`);
const fixedToken = process.env['CORTEX_TOKEN'];
if (fixedToken && fixedToken.length < 16) log.warn('[cortex] CORTEX_TOKEN is shorter than 16 characters: using a random token instead');
const token = makeToken(fixedToken);
const devOrigins = parseOrigins(process.env['CORTEX_DEV_ORIGIN']);
const devUrl = process.env['CORTEX_DEV_URL'];
const staticRoot = join(appRoot, 'out', 'renderer');

const registry = new Registry();
let broadcast: (channel: never, payload: never) => void = () => {};
const ipc = registerIpc({ registry, send: (channel, payload) => broadcast(channel as never, payload as never) }, { userData, appRoot, version: appVersion(appRoot), production });
const missing = registry.missing();
if (missing.length) throw new Error(`no handler for: ${missing.join(', ')}`);

const app = createCortexServer({
  registry,
  security: { port, token, devOrigins },
  staticRoot: existsSync(join(staticRoot, 'index.html')) ? staticRoot : undefined,
  devUrl: production ? undefined : devUrl,
  // a closed / reloaded tab knows none of its watch ids any more
  onClientGone: (clientId) => ipc.closeWatchers(clientId),
  log,
});
broadcast = app.broadcast as typeof broadcast;

app.server.on('error', (e: NodeJS.ErrnoException) => {
  log.error(e.code === 'EADDRINUSE' ? `[cortex] port ${port} is in use (another Cortex? set PORT=…)` : '[cortex] server error', e);
  process.exit(1);
});
app.server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
  log.info(`[cortex] ${production ? 'production' : 'development'} server, data in ${userData}`);
  // the token is the key to this machine's shell: print it, but keep it out of the log file
  console.log(`\n  Cortex is running: ${url}\n`);
});

// no orphaned agents / dev servers / test runs: kill every child tree on the way out
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info(`[cortex] ${signal}: stopping`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  try {
    await ipc.shutdown();
    await app.close();
  } catch (e) {
    log.error('[cortex] shutdown failed', e);
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGHUP', () => void shutdown('SIGHUP'));
