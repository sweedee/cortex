/**
 * `CORTEX_SMOKE=1 npm run dev`: once the renderer has loaded, call a few bridge methods
 * from inside the page (the real preload → IPC → handler path), print the results, quit.
 * Lets a headless run verify the bridge without anyone looking at the window.
 */
import { app, type BrowserWindow } from 'electron';

const PROBE = `(async () => {
  const c = window.cortex;
  if (!c) return { error: 'window.cortex missing' };
  const out = {};
  const step = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'ERROR: ' + e.message; } };
  await step('app.info', () => c.app.info());
  await step('workspace.path', () => c.workspace.path());
  await step('workspace.load', async () => { const d = await c.workspace.load(); return d ? { items: d.items?.length, links: d.links?.length } : null; });
  await step('exec.run git --version', async () => (await c.exec.run({ cmd: 'git', args: ['--version'], cwd: ${JSON.stringify(process.cwd())} })).stdout.trim());
  for (const cmd of ['gh', 'claude']) await step('exec.run ' + cmd + ' --version', async () => (await c.exec.run({ cmd, args: ['--version'], cwd: ${JSON.stringify(process.cwd())} })).stdout.trim().split(/\\r?\\n/)[0]);
  await step('exec.run rm (must be rejected)', () => c.exec.run({ cmd: 'rm', args: [], cwd: ${JSON.stringify(process.cwd())} }));
  await step('fs.list *.json', async () => (await c.fs.list(${JSON.stringify(process.cwd())}, { glob: '*.json' })).map((e) => e.name));
  await step('proc.list', () => c.proc.list());
  if (${JSON.stringify(!!process.env['CORTEX_USER_DATA'])}) {
    await step('workspace save+load (temp userData)', async () => { await c.workspace.save({ version: 0, items: [{ id: 'x' }], links: [] }); await c.workspace.save({ version: 0, items: [{ id: 'y' }], links: [] }); return c.workspace.load(); });
  }
  out.rootRendered = !!document.querySelector('#root')?.children.length;
  return out;
})()`;

export function runSmoke(win: BrowserWindow) {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const r: unknown = await win.webContents.executeJavaScript(PROBE);
        console.log('[smoke] ' + JSON.stringify(r, null, 2));
      } catch (err) {
        console.error('[smoke] failed:', err);
      }
      app.quit();
    }, 1500);
  });
}
