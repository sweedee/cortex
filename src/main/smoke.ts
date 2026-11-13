/**
 * `CORTEX_SMOKE=1 npm run dev`: once the renderer has loaded, call a few bridge methods
 * from inside the page (the real preload → IPC → handler path), print the results, quit.
 * Lets a headless run verify the bridge without anyone looking at the window.
 */
import { writeFile } from 'node:fs/promises';
import { app, type BrowserWindow } from 'electron';

const PROBE = `(async () => {
  const c = window.cortex;
  if (!c) return { error: 'window.cortex missing' };
  const out = {};
  const step = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'ERROR: ' + e.message; } };
  await step('app.info', () => c.app.info());
  await step('workspace.path', () => c.workspace.path());
  await step('workspace.load', async () => { const d = await c.workspace.load(); return d ? { version: d.version, items: d.items?.length, links: d.links?.length, prefs: d.prefs } : null; });
  await step('exec.run git --version', async () => (await c.exec.run({ cmd: 'git', args: ['--version'], cwd: ${JSON.stringify(process.cwd())} })).stdout.trim());
  for (const cmd of ['gh', 'claude']) await step('exec.run ' + cmd + ' --version', async () => (await c.exec.run({ cmd, args: ['--version'], cwd: ${JSON.stringify(process.cwd())} })).stdout.trim().split(/\\r?\\n/)[0]);
  await step('exec.run rm (must be rejected)', () => c.exec.run({ cmd: 'rm', args: [], cwd: ${JSON.stringify(process.cwd())} }));
  await step('fs.list *.json', async () => (await c.fs.list(${JSON.stringify(process.cwd())}, { glob: '*.json' })).map((e) => e.name));
  await step('proc.list', () => c.proc.list());
  if (${JSON.stringify(!!process.env['CORTEX_USER_DATA'])}) {
    await step('workspace save+load (temp userData)', async () => { await c.workspace.save({ version: 0, items: [], links: [], probe: 1 }); await c.workspace.save({ version: 0, items: [], links: [], probe: 2 }); return c.workspace.load(); });
  }
  // Phase 1 integrations (read-only)
  const repo = ${JSON.stringify(process.cwd())};
  await step('git.status (this repo)', async () => { const s = await c.git.status(repo); return { branch: s.branch, files: s.files.length, ahead: s.ahead, behind: s.behind }; });
  await step('git.remoteRepo', () => c.git.remoteRepo(repo));
  await step('git.worktreeList', async () => (await c.git.worktreeList(repo)).length);
  await step('git.log -n 2', async () => (await c.git.log(repo, { limit: 2 })).map((e) => e.subject));
  await step('jira.search (mock)', async () => (await c.jira.search('assignee = currentUser() AND statusCategory != Done')).map((i) => i.key + ' ' + i.fields.status.name));
  await step('exec.run jira-mock view', async () => { const r = await c.exec.run({ cmd: 'jira-mock', args: ['jira', 'workitem', 'view', 'CTX-4821', '--json', '--fields', 'summary'], cwd: repo }); return r.code === 0 ? JSON.parse(r.stdout).fields.summary : r.stderr; });
  await step('integrations.config', async () => (await c.integrations.config()).github.aiReviewComment);
  await step('claude.list', async () => (await c.claude.list()).length);
  await step('on(unknown) must throw', () => { try { c.on('nope', () => {}); return 'did not throw'; } catch (e) { return 'threw: ' + e.message; } });
  if (${JSON.stringify(process.env['CORTEX_SMOKE_GH_REPO'] ?? '')}) await step('gh.prList', async () => (await c.gh.prList(${JSON.stringify(process.env['CORTEX_SMOKE_GH_REPO'] ?? '')}, { state: 'all', limit: 2 })).map((p) => '#' + p.number + ' ' + p.state));
  await step('tests.run + app:state events', () => new Promise((resolve) => {
    const seen = [];
    const off = c.on('test:state', (s) => { seen.push(s.status); if (s.status !== 'running') { off(); resolve({ seen, summary: s.summary }); } });
    c.tests.run({ id: 'smoke', cwd: repo, command: 'node -e "console.log(String.fromCharCode(35)+\\' pass 1\\')"' }).catch((e) => { off(); resolve('ERROR: ' + e.message); });
  }));
  out.rootRendered = !!document.querySelector('#root')?.children.length;
  return out;
})()`;

export function runSmoke(win: BrowserWindow) {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const r: unknown = await win.webContents.executeJavaScript(PROBE);
        console.log('[smoke] ' + JSON.stringify(r, null, 2));
        // CORTEX_SMOKE_SHOT=<file.png>: also save a screenshot of the window
        const shot = process.env['CORTEX_SMOKE_SHOT'];
        if (shot) {
          await writeFile(shot, (await win.webContents.capturePage()).toPNG());
          console.log(`[smoke] screenshot: ${shot}`);
        }
      } catch (err) {
        console.error('[smoke] failed:', err);
      }
      app.quit();
    }, 1500);
  });
}
