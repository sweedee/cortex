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
  // CORTEX_SMOKE_E2E=1 (dev only, uses window.__cortexDebug): renderer flows end to end. Start with
  // CORTEX_CLAUDE_BIN=<fake-claude.mjs> so no real (paid) Claude session is started.
  const d = window.__cortexDebug;
  if (${JSON.stringify(process.env['CORTEX_SMOKE_E2E'] === '1')} && d) {
    const until = async (get, pred, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = get(); if (pred(v)) return v; if (Date.now() - t0 > ms) throw new Error('timeout, last: ' + JSON.stringify(v && v.data)); await new Promise((r) => setTimeout(r, 100)); } };
    let wt;
    await step('e2e: project on this repo + worktree git refresh', async () => {
      const remote = await c.git.remoteRepo(repo);
      const branch = await c.git.currentBranch(repo);
      const p = d.addItem({ kind: 'project', handle: 'smoke-cortex', title: 'cortex (smoke)', data: { repo: remote || 'sweedee/cortex', baseDir: repo, defaultBranch: 'main' } });
      wt = d.addItem({ kind: 'worktree', handle: 'wt/smoke', title: branch, projectId: p.id, data: { path: repo, branch: branch || 'HEAD', baseBranch: 'main' } });
      d.addLink(wt.id, p.id, 'belongs to');
      await d.refreshDue(true);
      return { repo: remote, worktreeGit: d.itemById(wt.id).data.git, projectStats: d.itemById(p.id).data.stats };
    });
    if (wt) await step('e2e: chat → agent → question → answer (claude bin: ' + ${JSON.stringify((process.env['CORTEX_CLAUDE_BIN'] ?? 'claude').split(/[\\/]/).pop())} + ')', async () => {
      if (!${JSON.stringify(/fake-claude/.test(process.env['CORTEX_CLAUDE_BIN'] ?? ''))}) return 'skipped: set CORTEX_CLAUDE_BIN to the fake CLI';
      const id = await d.sendPrompt('ask which approach to take for @wt/smoke', [wt.id]);
      const a1 = await until(() => d.itemById(id), (a) => a && a.data.status === 'waiting' && a.data.pendingQuestion);
      const asked = { status: a1.data.status, question: a1.data.pendingQuestion.questions[0].question, options: a1.data.pendingQuestion.questions[0].options.map((o) => o.label), notice: a1.notice && a1.notice.text };
      d.chooseOption(a1, 'Queue');
      const a2 = await until(() => d.itemById(id), (a) => a && a.data.status === 'done');
      const session = await c.claude.session(id);
      return { cwd: a2.data.cwd, sessionId: !!a2.data.sessionId, asked, done: { status: a2.data.status, lastActivity: a2.data.lastActivity, notice: a2.notice && a2.notice.text, usage: a2.data.usage }, promptSent: session.messages[0] && session.messages[0].text };
    });
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
