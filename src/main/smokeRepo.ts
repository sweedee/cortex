/**
 * `CORTEX_SMOKE=1 CORTEX_SMOKE_REPO=1 npm run dev` (with `CORTEX_CLAUDE_BIN=<fake-claude.mjs>` and an
 * isolated `CORTEX_USER_DATA`): a click-through of the main flows against a real, throw-away git
 * repo. Everything stays local:
 *
 * - a temp repo whose `origin` is a local bare repo (so `git push` works offline), with a `dev`
 *   script (tiny HTTP server) and a `test` script (vitest-like output, one failing test)
 * - the flows run through the renderer's debug handle (`debug.ts`): actions by id, forms filled
 *   and submitted through `formDriver`, sidebars opened and read from the DOM
 * - `gh pr create` is expected to fail (no GitHub remote); start with `GH_HOST=smoke.invalid` so gh
 *   never talks to github.com at all
 *
 * Prints a checklist (`[smoke-repo] ✔ / ✘ step: detail`) and saves screenshots to
 * `CORTEX_SMOKE_OUT` (default: `<tmp>/cortex-smoke-<time>`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';

const SERVER_JS = `const s = require('http').createServer((q, r) => r.end('<h1>smoke-demo dev server</h1>'));
s.listen(0, '127.0.0.1', () => console.log('  Local: http://localhost:' + s.address().port + '/'));
`;
const TEST_JS = `const lines = [
  ' RUN  v3.2.4 ' + process.cwd(),
  '',
  ' ❯ src/retry.spec.ts (3 tests | 1 failed) 7ms',
  '   ✓ retries 3 times 2ms',
  '   ✓ gives up after maxRetries 1ms',
  '   × caps the delay at maxDelay 4ms',
  '',
  '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
  '',
  ' FAIL  src/retry.spec.ts > retry > caps the delay at maxDelay',
  'AssertionError: expected 6400 to be less than or equal to 5000',
  '',
  ' Test Files  1 failed (1)',
  '      Tests  1 failed | 2 passed (3)',
];
console.log(lines.join('\\n'));
process.exit(1);
`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Cortex Smoke', '-c', 'user.email=smoke@cortex.invalid', ...args], { cwd, encoding: 'utf8' }).trim();

/** The throw-away world: `<root>/origin.git` (bare), `<root>/repo` (base checkout), `<root>/wt` (worktrees). */
function makeRepo(root: string) {
  const bare = join(root, 'origin.git');
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(root, 'wt'), { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', bare]);
  git(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'smoke-demo', private: true, scripts: { dev: 'node server.js', test: 'node test.js' } }, null, 2) + '\n');
  writeFileSync(join(repo, 'server.js'), SERVER_JS);
  writeFileSync(join(repo, 'test.js'), TEST_JS);
  writeFileSync(join(repo, 'README.md'), '# smoke-demo\n\nA throw-away repo for the Cortex click-through smoke.\n');
  writeFileSync(join(repo, '.gitignore'), 'records/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'Initial commit');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-u', 'origin', 'main');
  return { bare, repo, wtDir: join(root, 'wt') };
}

/** Helpers installed once in the page (`window.__smk`). */
const HELPERS = `window.__smk = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(get, pred, ms = 20000, what = 'condition') {
    const t0 = Date.now();
    for (;;) {
      let v; try { v = get(); } catch (e) { v = undefined; }
      if (pred(v)) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what + (v && v.data ? ': ' + JSON.stringify(v.data).slice(0, 300) : ''));
      await new Promise((r) => setTimeout(r, 120));
    }
  },
  $: (s) => document.querySelector(s),
  $$: (s) => [...document.querySelectorAll(s)],
  text: (s) => (document.querySelector(s) || {}).textContent || '',
  byKind: (k) => window.__cortexDebug.getState().items.filter((i) => i.kind === k),
  tab: (label) => { const b = [...document.querySelectorAll('.sidebar-tab')].find((x) => x.textContent.trim().startsWith(label)); if (b) b.click(); return !!b; },
  async form(title, ms = 10000) { const d = window.__cortexDebug; return window.__smk.until(() => d.forms.open().find((f) => f.title.includes(title)), Boolean, ms, 'form ' + title); },
};`;

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runRepoSmoke(win: BrowserWindow) {
  const root = process.env['CORTEX_SMOKE_OUT'] || join(tmpdir(), `cortex-smoke-${Date.now().toString(36)}`);
  const shots = join(root, 'shots');
  mkdirSync(shots, { recursive: true });
  const steps: Step[] = [];
  const wc = win.webContents;
  /** run `async (d, h) => …` in the page; JSON result */
  const page = async <T = unknown>(fn: string): Promise<T> => wc.executeJavaScript(`(async () => { const d = window.__cortexDebug; const h = window.__smk; return await (${fn})(d, h); })()`) as Promise<T>;
  const shot = async (name: string) => {
    await new Promise((r) => setTimeout(r, 700));
    const file = join(shots, `${String(steps.length).padStart(2, '0')}-${name}.png`);
    writeFileSync(file, (await wc.capturePage()).toPNG());
    return file;
  };
  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail });
      console.log(`[smoke-repo] ✔ ${name}: ${detail}`);
    } catch (e) {
      const detail = (e as Error).message.replace(/^Error invoking remote method[^:]*: /, '').split('\n')[0];
      steps.push({ name, ok: false, detail });
      console.log(`[smoke-repo] ✘ ${name}: ${detail}`);
      await shot(`failed-${name.replace(/\W+/g, '-').slice(0, 40)}`).catch(() => '');
      // don't leave a failed form in front of the next step
      await page(`async (d) => { for (const f of d.forms.open()) d.forms.cancel(f.title); return true; }`).catch(() => false);
    }
  };

  let r: ReturnType<typeof makeRepo> | undefined;
  await step('temp repo with a local bare origin', async () => {
    r = makeRepo(root);
    return `${r.repo} → ${r.bare}`;
  });
  if (!r) return finish();
  const { repo, bare } = r;
  const J = JSON.stringify;

  await page(`async () => { ${HELPERS} return true; }`);
  const debugOk = await page<boolean>(`async (d) => !!d`);
  if (!debugOk) {
    steps.push({ name: 'debug handle', ok: false, detail: 'window.__cortexDebug missing (dev, or a build opened with #smoke)' });
    return finish();
  }

  // an empty canvas, plus the Jira mock's CTX-4821 as a ticket bubble
  await page(`async (d) => { d.replaceWorld([], []); d.inspect(null); return true; }`);

  let projectId = '';
  await step('project via Add → Project (settings form, base checkout detection)', async () => {
    const p = await page<{ id: string; title: string; data: Record<string, unknown> }>(`async (d, h) => {
      d.openAdd('project', { x: 0, y: 0 });
      await h.form('Add project');
      const err = await d.forms.submit({ baseDir: ${J(repo)}, name: 'smoke-demo', repo: 'cortex-smoke/smoke-demo' }, 'Add project');
      if (err) throw new Error('form: ' + err);
      const p = h.byKind('project')[0];
      if (!p) throw new Error('no project item');
      d.inspect(p.id);
      await h.sleep(2500);
      return p;
    }`);
    projectId = p.id;
    const d = p.data;
    if (d['startCommand'] !== 'npm run dev' || d['testCommand'] !== 'npm test') throw new Error(`commands not detected: ${J(d)}`);
    return `${p.title}: repo ${d['repo']}, branch ${d['defaultBranch']}, start "${d['startCommand']}", test "${d['testCommand']}", worktrees ${d['worktreesDir']}`;
  });
  await shot('project-sidebar').catch(() => '');
  if (!projectId) return finish();

  let ticketId = '';
  await step('ticket bubble for the mock CTX-4821', async () => {
    ticketId = await page<string>(`async (d) => {
      const t = d.addItem({ kind: 'ticket', handle: 'CTX-4821', title: 'CTX-4821', projectId: ${J(projectId)}, data: { key: 'CTX-4821', status: 'To Do', statusCategory: 'new', type: 'Story' } });
      d.addLink(t.id, ${J(projectId)}, 'in project');
      await d.refreshDue(true);
      return t.id;
    }`);
    const t = await page<{ title: string; data: { status: string } }>(`async (d) => d.itemById(${J(ticketId)})`);
    return `${t.title} (${t.data.status})`;
  });

  let wtId = '';
  let wtPath = '';
  let branch = '';
  await step('project "New worktree" form → git worktree add → bubble linked to the ticket', async () => {
    const w = await page<{ id: string; data: { path: string; branch: string } }>(`async (d, h) => {
      d.runAction(${J(projectId)}, 'new-wt');
      await h.form('New worktree');
      const err = await d.forms.submit({ ticketId: ${J(ticketId)} }, 'New worktree');
      if (err) throw new Error('form: ' + err);
      return h.until(() => h.byKind('worktree')[0], Boolean, 10000, 'worktree item');
    }`);
    wtId = w.id;
    wtPath = w.data.path;
    branch = w.data.branch;
    const list = git(repo, 'worktree', 'list', '--porcelain');
    if (!list.replace(/\\/g, '/').includes(wtPath.replace(/\\/g, '/'))) throw new Error(`${wtPath} not in git worktree list`);
    const linked = await page<boolean>(`async (d) => d.getState().links.some((l) => l.from === ${J(wtId)} && l.to === ${J(ticketId)})`);
    if (!linked) throw new Error('worktree not linked to the ticket');
    return `${branch} at ${wtPath}`;
  });
  if (!wtId) return finish();

  let appId = '';
  await step('worktree "Launch app" → app running with a URL', async () => {
    const a = await page<{ id: string; data: { url?: string; state: string } }>(`async (d, h) => {
      d.runAction(${J(wtId)}, 'launch');
      const a = await h.until(() => h.byKind('app')[0], (x) => x && x.data.state === 'running' && x.data.url, 30000, 'app running');
      d.select([a.id]); d.inspect(a.id);
      await h.until(() => h.$('webview'), Boolean, 10000, 'preview webview');
      await h.sleep(1500);
      return a;
    }`);
    appId = a.id;
    return `${a.data.url}`;
  });
  await shot('app-preview');

  await step('worktree "Run tests" → testrun failed, failing test named', async () => {
    const t = await page<{ data: { state: string; summary?: { passed: number; failed: number } }; failing: string[] }>(`async (d, h) => {
      d.runAction(${J(wtId)}, 'tests');
      const t = await h.until(() => h.byKind('testrun')[0], (x) => x && x.data.state === 'failed', 30000, 'testrun failed');
      d.select([t.id]); d.inspect(t.id);
      await h.until(() => document.body.textContent.includes('caps the delay at maxDelay'), Boolean, 10000, 'failing test in the sidebar');
      return { ...t, failing: h.$$('.sidebar-body *').filter((e) => e.children.length === 0 && /caps the delay/.test(e.textContent)).map((e) => e.textContent.trim()).slice(0, 2) };
    }`);
    if (t.data.summary?.failed !== 1) throw new Error(`summary ${J(t.data.summary)}`);
    return `${t.data.summary.failed} failed / ${t.data.summary.passed} passed; sidebar: ${t.failing[0]}`;
  });
  await shot('testrun-sidebar');

  await step('a commit in the worktree → Changes tab shows the diff', async () => {
    writeFileSync(join(wtPath, 'retry.js'), 'export const maxDelay = 5000;\nexport const retries = 3;\n');
    writeFileSync(join(wtPath, 'README.md'), '# smoke-demo\n\nA throw-away repo for the Cortex click-through smoke.\n\nNow with retries.\n');
    git(wtPath, 'add', '-A');
    git(wtPath, 'commit', '-m', 'Add retry settings');
    const res = await page<{ files: string[]; ahead?: number }>(`async (d, h) => {
      await d.refreshDue(true);
      d.select([${J(wtId)}]); d.inspect(${J(wtId)});
      await h.until(() => h.tab('Changes'), Boolean, 5000, 'Changes tab');
      await h.until(() => h.$('.cxv-diff-hunk'), Boolean, 15000, 'diff hunks');
      return { files: h.$$('.cxv-diff-name').map((e) => e.textContent.trim()), ahead: d.itemById(${J(wtId)}).data.git?.ahead };
    }`);
    if (!res.files.length) throw new Error('empty diff');
    return `files ${res.files.join(', ')}; ring cache ahead=${res.ahead}`;
  });
  await shot('worktree-changes');

  await step(`record file records/<branch>/plan.md → record bubble, linked`, async () => {
    const dir = join(repo, 'records', ...branch.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plan.md'), `# Plan: ${branch}\n\n- [x] Reproduce the 503 drop\n- [ ] Cap the delay at maxDelay\n- [ ] Add jitter\n\n\`\`\`mermaid\nflowchart LR\n  Retry --> Cap --> Jitter\n\`\`\`\n`);
    const rec = await page<{ id: string; title: string; data: { steps?: { done: number; total: number }; recordType: string }; links: string[] }>(`async (d, h) => {
      const r = await h.until(() => h.byKind('record')[0], Boolean, 40000, 'record item');
      d.select([r.id]); d.inspect(r.id);
      await h.until(() => h.$('.sidebar-body svg[id^="mermaid"], .sidebar-body [class*="mermaid"] svg'), Boolean, 15000, 'markdown + mermaid');
      const cur = d.itemById(r.id);
      return { ...cur, links: d.getState().links.filter((l) => l.from === r.id || l.to === r.id).map((l) => d.itemById(l.from === r.id ? l.to : l.from).kind + ':' + l.label) };
    }`);
    if (!rec.links.some((l) => l.startsWith('worktree:'))) throw new Error(`not linked to the worktree: ${rec.links.join(', ')}`);
    return `${rec.title} (${rec.data.recordType}, steps ${rec.data.steps?.done}/${rec.data.steps?.total}), links ${rec.links.join(', ')}`;
  });
  await shot('record-sidebar');

  await step('todo: add via form, edit title and tick a task in the sidebar', async () => {
    const t = await page<{ title: string; body: string }>(`async (d, h) => {
      d.select([${J(projectId)}]);
      d.openAdd('todo', { x: 200, y: 200 });
      await h.form('Add todo');
      const err = await d.forms.submit({ title: 'Ask about the retry cap', body: '- [ ] check the SLO\\n- [ ] ask Mara' }, 'Add todo');
      if (err) throw new Error('form: ' + err);
      const todo = await h.until(() => h.byKind('todo')[0], Boolean, 5000, 'todo item');
      const input = await h.until(() => h.$('.todo-title'), Boolean, 5000, 'title input');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Ask Mara about the retry cap');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      [...document.querySelectorAll('.sidebar-body button')].find((b) => b.textContent.trim() === 'Preview').click();
      const box = await h.until(() => h.$('.todo-preview input[type=checkbox]'), Boolean, 5000, 'task checkbox');
      box.click();
      const cur = await h.until(() => d.itemById(todo.id), (x) => x.title === 'Ask Mara about the retry cap' && x.data.body.includes('[x]'), 5000, 'todo saved');
      return { title: cur.title, body: cur.data.body };
    }`);
    return `"${t.title}", body ${J(t.body)}`;
  });
  await shot('todo-sidebar');

  await step('worktree "Create PR": push reaches the bare origin; gh failure shown in the form', async () => {
    const err = await page<string | null>(`async (d, h) => {
      d.runAction(${J(wtId)}, 'create-pr');
      const f = await h.form('Create pull request');
      return d.forms.submit({}, 'Create pull request');
    }`);
    const remoteHead = execFileSync('git', ['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${branch}`], { encoding: 'utf8' }).trim();
    const localHead = git(wtPath, 'rev-parse', 'HEAD');
    if (remoteHead !== localHead) throw new Error(`origin has ${remoteHead}, worktree ${localHead}`);
    if (!err) throw new Error('gh pr create unexpectedly succeeded');
    const shown = await page<string>(`async (d, h) => h.text('.form-failure')`);
    return `origin/${branch} = ${localHead.slice(0, 8)}; form error: "${shown.slice(0, 160)}"`;
  });
  await shot('create-pr-error');
  await page(`async (d) => { d.forms.cancel('Create pull request'); return true; }`);

  await step('ticket "Change status…" (jira mock): next status, then an invalid jump', async () => {
    // the mock's workflow: To Do → In Progress → In Review → Done
    const flow = ['To Do', 'In Progress', 'In Review', 'Done'];
    const from = await page<string>(`async (d) => d.itemById(${J(ticketId)}).data.status`);
    const to = flow[Math.min(flow.indexOf(from) + 1, flow.length - 1)] ?? 'In Progress';
    const t = await page<{ data: { status: string; statusCategory: string } }>(`async (d, h) => {
      d.runAction(${J(ticketId)}, 'status');
      await h.form('Change status');
      const err = await d.forms.submit({ status: ${J(to)} }, 'Change status');
      if (err) throw new Error('form: ' + err);
      const t = await h.until(() => d.itemById(${J(ticketId)}), (x) => x.data.status === ${J(to)}, 10000, 'new status');
      d.select([t.id]); d.inspect(t.id);
      await h.sleep(1000);
      return t;
    }`);
    const jump = to === 'Done' ? 'In Review' : 'Done';
    const bad = await page<string | null>(`async (d, h) => {
      d.runAction(${J(ticketId)}, 'status');
      await h.form('Change status');
      const err = await d.forms.submit({ status: ${J(jump)} }, 'Change status');
      d.forms.cancel('Change status');
      return err;
    }`);
    return `${from} → ${t.data.status} (${t.data.statusCategory}); ${t.data.status} → ${jump}: ${bad ? `rejected inline ("${bad.slice(0, 110)}")` : 'accepted by the mock'}`;
  });
  await shot('ticket-sidebar');

  await step('agent (fake Claude CLI): question → answer → done', async () => {
    if (!/fake-claude/.test(process.env['CORTEX_CLAUDE_BIN'] ?? '')) throw new Error('skipped: set CORTEX_CLAUDE_BIN to the fake CLI (no real sessions in the smoke)');
    const a = await page<{ data: { status: string; cwd: string; lastActivity?: string }; question: string }>(`async (d, h) => {
      const wt = d.itemById(${J(wtId)});
      const id = await d.sendPrompt('ask which approach to take for @' + wt.handle, [wt.id]);
      const a1 = await h.until(() => d.itemById(id), (a) => a && a.data.status === 'waiting' && a.data.pendingQuestion, 20000, 'question');
      d.select([id]); d.inspect(id);
      await h.until(() => h.$('.ah-ask[role="form"]'), Boolean, 10000, 'question card');
      await h.sleep(800);
      const question = a1.data.pendingQuestion.questions[0].question;
      d.chooseOption(a1, 'Queue');
      const a2 = await h.until(() => d.itemById(id), (a) => a.data.status === 'done', 20000, 'done');
      await h.sleep(800);
      return { ...a2, question };
    }`);
    if (a.data.cwd.replace(/\\/g, '/') !== wtPath.replace(/\\/g, '/')) throw new Error(`cwd ${a.data.cwd}`);
    return `asked "${a.question}", answered Queue → ${a.data.status} (${a.data.lastActivity}), cwd = worktree`;
  });
  await shot('agent-harness');

  await step('settings dialog (HUD gear)', async () => {
    const f = await page<{ values: Record<string, unknown> } | undefined>(`async (d, h) => {
      d.inspect(null);
      [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Settings').click();
      return h.form('Settings');
    }`);
    return `workspace ${f?.values['workspacePath']}, jira: ${String(f?.values['jira']).split(';')[0]}`;
  });
  await shot('settings');
  await page(`async (d) => { d.forms.cancel('Settings'); return true; }`);

  await step('worktree "Remove…" → archived and gone from git worktree list', async () => {
    const w = await page<{ archived?: boolean }>(`async (d, h) => {
      if (${J(appId)}) { d.runAction(${J(appId)}, 'stop'); await h.until(() => d.itemById(${J(appId)}), (x) => x.data.state === 'stopped', 15000, 'app stopped'); }
      d.runAction(${J(wtId)}, 'remove-wt');
      await h.form('Remove worktree');
      const err = await d.forms.submit({ force: true }, 'Remove worktree');
      if (err) throw new Error('form: ' + err);
      return h.until(() => d.itemById(${J(wtId)}), (x) => x.archived, 10000, 'archived');
    }`);
    const list = git(repo, 'worktree', 'list', '--porcelain').replace(/\\/g, '/');
    if (list.includes(wtPath.replace(/\\/g, '/'))) throw new Error('still in git worktree list');
    return `archived=${w.archived}; git worktree list: ${list.split('\n').filter((l) => l.startsWith('worktree ')).length} entr${list.split('\n').filter((l) => l.startsWith('worktree ')).length === 1 ? 'y' : 'ies'}`;
  });
  await page(`async (d) => { d.inspect(null); d.select([]); return true; }`);
  await shot('canvas-end');

  return finish();

  function finish() {
    console.log('\n[smoke-repo] checklist');
    for (const s of steps) console.log(`[smoke-repo] - [${s.ok ? 'x' : ' '}] ${s.name}: ${s.detail}`);
    console.log(`[smoke-repo] ${steps.filter((s) => s.ok).length}/${steps.length} ok · screenshots in ${shots}`);
    app.quit();
  }
}
