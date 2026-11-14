/**
 * `CORTEX_SMOKE=1 npm run dev`: once the renderer has loaded, call a few bridge methods
 * from inside the page (the real preload → IPC → handler path), print the results, quit.
 * Lets a headless run verify the bridge without anyone looking at the window.
 */
import { writeFile } from 'node:fs/promises';
import { app, type BrowserWindow } from 'electron';
import { runRepoSmoke } from './smokeRepo';

/** a tiny HTTP server on a random port that prints its URL like a dev server (phase 3d app e2e) */
const SMOKE_APP_CMD = `node -e "const s=require('http').createServer((q,r)=>r.end('<h1>hi from the smoke app</h1>'));s.listen(0,'127.0.0.1',()=>console.log('  Local: http://localhost:'+s.address().port+'/'))"`;
const SMOKE_CRASH_CMD = `node -e "console.log('boom: config missing');process.exit(2)"`;

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
  // CORTEX_SMOKE_GALLERY=1: every viewer with sample data (mermaid, CodeMirror, diff…) under the real CSP
  if (${JSON.stringify(process.env['CORTEX_SMOKE_GALLERY'] === '1')} && window.__cortexDebug) {
    await step('gallery: viewers render under the CSP', async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective + ' ' + e.blockedURI));
      await window.__cortexDebug.showGallery();
      const t0 = Date.now();
      const q = (s) => document.querySelector(s);
      while (Date.now() - t0 < 20000 && !(q('.cm-editor') && q('svg[id^="mermaid"], .mermaid svg, [class*="mermaid"] svg') && q('.cxv-diff-hunk'))) await new Promise((r) => setTimeout(r, 200));
      return { codemirror: !!q('.cm-editor'), mermaid: !!q('svg[id^="mermaid"], .mermaid svg, [class*="mermaid"] svg'), diff: !!q('.cxv-diff-hunk'), cspMeta: q('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.slice(0, 60), violations };
    });
  }
  // CORTEX_SMOKE_E2E=1 (dev, or a build opened with #smoke; uses window.__cortexDebug): renderer flows end to end. Start with
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
    // phase 3d: the agent harness sidebar and the app kind, driven through the DOM / item actions
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => [...document.querySelectorAll(sel)];
    const untilDom = (fn, ms = 15000) => until(fn, (v) => !!v, ms);
    const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));
    const typeInto = (el, text) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    let harnessAgent;
    if (wt && ${JSON.stringify(/fake-claude/.test(process.env['CORTEX_CLAUDE_BIN'] ?? ''))}) await step('e2e: agent harness (permission card → allow, composer follow-up → question card → submit, Esc interrupts)', async () => {
      const id = await d.sendPrompt('bash something for @wt/smoke', [wt.id]);
      harnessAgent = id;
      await until(() => d.itemById(id), (a) => a && a.data.status === 'waiting' && a.data.pendingPermissions);
      d.select([id]);
      d.inspect(id);
      const perm = await untilDom(() => $('.ah-perm'));
      const permText = perm.textContent;
      button(perm, 'Allow').click();
      await until(() => d.itemById(id), (a) => a.data.status === 'done');
      const row = await untilDom(() => $('.ah-tool-row:not(:disabled)'));
      row.click();
      const detail = (await untilDom(() => $('.ah-tool-detail'))).textContent;
      const ta = $('.ah-composer textarea');
      typeInto(ta, 'ask once more');
      await sleep(50);
      key(ta, 'Enter');
      const card = await untilDom(() => $('.ah-ask[role="form"]'));
      const options = $$('.ah-ask[role="form"] .ah-ask-opt').map((b) => b.textContent);
      [...card.querySelectorAll('.ah-ask-opt')].find((b) => b.textContent.includes('Queue')).click();
      await sleep(50);
      button(card, 'Submit').click();
      await until(() => d.itemById(id), (a) => a.data.status === 'done' && /Queue/.test(a.data.lastActivity || ''));
      await untilDom(() => $$('.ah-md').some((e) => /You chose Queue/.test(e.textContent)));
      typeInto($('.ah-composer textarea'), 'slow down');
      await sleep(50);
      key($('.ah-composer textarea'), 'Enter');
      await until(() => d.itemById(id), (a) => a.data.status === 'running');
      await untilDom(() => $('.ah-working'));
      key($('.ah-composer textarea'), 'Escape');
      const after = await until(() => d.itemById(id), (a) => a.data.status === 'idle');
      return { permText, detail, options, answered: $('.ah-ask.is-done') && $('.ah-ask.is-done').textContent, afterEsc: { status: after.data.status, lastActivity: after.data.lastActivity }, blocks: $$('.ah-scroll > *').length, statusLine: $('.ah-status').textContent };
    });
    const portState = async (port) => (await c.exec.run({ cmd: 'node', args: ['-e', "require('net').connect(" + port + ",'127.0.0.1').on('connect',function(){console.log('open');process.exit(0)}).on('error',function(){console.log('closed')})"], cwd: repo })).stdout.trim();
    const pidState = async (pid) => (await c.exec.run({ cmd: 'node', args: ['-e', 'try{process.kill(' + pid + ',0);console.log("alive")}catch(e){console.log("gone")}'], cwd: repo })).stdout.trim();
    let smokeApp;
    await step('e2e: app start → URL → preview → restart → stop (process tree gone) · crash', async () => {
      const a = d.addItem({ kind: 'app', handle: 'app/smoke', title: 'smoke server', data: { command: ${JSON.stringify(SMOKE_APP_CMD)}, cwd: repo, state: 'stopped' } });
      smokeApp = a.id;
      const seen = [];
      const off = c.on('app:state', (s) => { if (s.id === a.id) seen.push(s.status); });
      d.runAction(a.id, 'start');
      const r1 = await until(() => d.itemById(a.id), (x) => x.data.state === 'running' && x.data.url);
      const pid1 = (await c.apps.list()).find((s) => s.id === a.id).pid;
      const port1 = r1.data.port;
      const open1 = await portState(port1);
      d.inspect(a.id);
      const wv = await untilDom(() => $('webview'));
      const preview = { src: wv.getAttribute('src'), partition: wv.getAttribute('partition') };
      d.runAction(a.id, 'restart');
      const r2 = await until(() => d.itemById(a.id), (x) => x.data.state === 'running' && x.data.port && x.data.port !== port1);
      const pid2 = (await c.apps.list()).find((s) => s.id === a.id).pid;
      const afterRestart = { oldPort: await portState(port1), oldPid: await pidState(pid1), newPort: await portState(r2.data.port) };
      d.runAction(a.id, 'stop');
      await until(() => d.itemById(a.id), (x) => x.data.state === 'stopped');
      await sleep(300);
      const afterStop = { port: await portState(r2.data.port), pid: await pidState(pid2) };
      off();
      const b = d.addItem({ kind: 'app', handle: 'app/crashy', title: 'crashy', data: { command: ${JSON.stringify(SMOKE_CRASH_CMD)}, cwd: repo, state: 'stopped' } });
      d.runAction(b.id, 'start');
      const cr = await until(() => d.itemById(b.id), (x) => x.data.state === 'crashed');
      d.inspect(b.id);
      const crashUi = (await untilDom(() => $('.ap-critical') && $$('.ap-tail').some((e) => /boom/.test(e.textContent)) && $('.ap-empty'))).textContent;
      return { url: r1.data.url, open1, preview, states: seen, afterRestart, afterStop, crash: { state: cr.data.state, notice: cr.notice && cr.notice.text, ui: crashUi.slice(0, 160) } };
    });
    // what the screenshot shows: CORTEX_SMOKE_FINAL=app → the running app's preview; agent (default) → the agent harness; an item id → that item
    if (${JSON.stringify(process.env['CORTEX_SMOKE_FINAL'] ?? 'agent')} === 'app' && smokeApp) {
      await step('e2e: final view = app preview', async () => {
        d.runAction(smokeApp, 'start');
        await until(() => d.itemById(smokeApp), (x) => x.data.state === 'running' && x.data.url);
        d.select([smokeApp]);
        d.inspect(smokeApp);
        await untilDom(() => $('webview'));
        await sleep(2500);
        return d.itemById(smokeApp).data.url;
      });
    } else {
      // 'agent' = the harness of the agent driven above; any other value = that item id (e.g. a seed item)
      const final = ${JSON.stringify(process.env['CORTEX_SMOKE_FINAL'] ?? 'agent')};
      const target = final === 'agent' ? harnessAgent : final;
      if (target && d.itemById(target)) {
        d.select([target]);
        d.inspect(target);
        await sleep(1500);
      }
    }
  }
  out.rootRendered = !!document.querySelector('#root')?.children.length;
  return out;
})()`;

export function runSmoke(win: BrowserWindow) {
  win.webContents.once('did-finish-load', () => {
    // CORTEX_SMOKE_REPO=1: the real-repo click-through (smokeRepo.ts) instead of the bridge probe
    if (process.env['CORTEX_SMOKE_REPO'] === '1') {
      setTimeout(() => void runRepoSmoke(win).catch((err) => (console.error('[smoke-repo] failed:', err), app.quit())), 2500);
      return;
    }
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
