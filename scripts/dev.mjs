// `npm run dev`: the Cortex server with `tsx watch` (restarts on changes) + the Vite dev server for the
// renderer (hot reload), in one terminal. One token for the whole session, so a server restart keeps
// the browser signed in. Open the printed URL: it signs in on the server and redirects to Vite.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const port = Number(process.env.PORT || 4317);
const vitePort = Number(process.env.VITE_PORT || 5173);
const token = process.env.CORTEX_TOKEN || randomBytes(24).toString('base64url');
const viteOrigin = `http://127.0.0.1:${vitePort}`;

const require = createRequire(import.meta.url);
const server = spawn(process.execPath, [require.resolve('tsx/cli'), 'watch', '--clear-screen=false', 'src/server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), CORTEX_TOKEN: token, CORTEX_DEV_ORIGIN: viteOrigin, CORTEX_DEV_URL: `${viteOrigin}/` },
});

process.env.CORTEX_PORT = String(port);
const vite = await createServer({ configFile: 'vite.config.ts', server: { port: vitePort, strictPort: true } });
await vite.listen();
console.log(`\n  Renderer (Vite): ${viteOrigin}/  (sign in first: open the Cortex URL above)\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.kill('SIGTERM');
  await vite.close();
  process.exit(0);
};
server.on('exit', (code) => {
  if (!stopping) console.error(`[dev] server exited (${code})`);
  void stop();
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
