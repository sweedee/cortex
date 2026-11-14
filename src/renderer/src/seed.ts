/**
 * The first-run world.
 *
 * - **Demo** (`demoWorld`): the real demo repo `sweedee/cortex-demo` (a tiny todo app with GitHub
 *   Actions CI) checked out at `~/Documents/cortex-demo`, its worktrees in `~/Documents/wt/cortex-demo/`,
 *   the Jira project CTX (via acli), the open PRs #1, #2 (stacked on #1) and #3 (failing tests), and
 *   `sweedee/cortex` read-only (no checkout configured). Everything here exists for real, so the
 *   refresher only updates it; the values below are what it looked like when the demo was set up.
 * - **Empty** (`emptyWorld`): when the demo checkout is not on this machine, a welcome todo that says
 *   how to add a project.
 *
 * `firstRunWorld()` picks one (see persist.ts); "Reset workspace" uses it too.
 */
import type { Item, Link, NewItem } from './domain';
import { native } from './native';

export const DEMO_REPO = 'sweedee/cortex-demo';
export const DEMO_JIRA_PROJECT = 'CTX';

export interface World {
  items: Item[];
  links: Link[];
}

/** Path join that keeps the home folder's separator style (Windows `\`, else `/`). */
function joiner(home: string) {
  const sep = home.includes('\\') ? '\\' : '/';
  return (...parts: string[]) => [home.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

/** Where the demo checkout is expected. */
export const demoBaseDir = (home: string) => joiner(home)('Documents', 'cortex-demo');

export function demoWorld(home: string, now = Date.now()): World {
  const p = joiner(home);
  const base = demoBaseDir(home);
  const wt = (name: string) => p('Documents', 'wt', 'cortex-demo', name);
  const ago = (min: number) => now - min * 60_000;
  const at = (n: NewItem & { id: string }, createdMinAgo = 60 * 3): Item => ({ ...n, createdAt: ago(createdMinAgo), updatedAt: ago(Math.min(createdMinAgo, 20)) }) as Item;
  const me = 'Sven-Nicolai Wavruska';
  const runUrl = (run: string, job: string) => `https://github.com/${DEMO_REPO}/actions/runs/${run}/job/${job}`;

  const items: Item[] = [
    // ---- projects -------------------------------------------------------------
    at({
      id: 'p-demo',
      kind: 'project',
      handle: 'cortex-demo',
      title: 'cortex-demo',
      data: {
        repo: DEMO_REPO,
        baseDir: base,
        worktreesDir: p('Documents', 'wt', 'cortex-demo'),
        defaultBranch: 'main',
        startCommand: 'npm start',
        testCommand: 'npm test',
        stats: { mainChecks: 'success', openPrs: 3 },
      },
    }),
    at({
      id: 'p-cortex',
      kind: 'project',
      handle: 'cortex',
      title: 'cortex',
      // read-only: no base checkout, so nothing writes to it; set one in its settings to work on it
      data: { repo: 'sweedee/cortex', defaultBranch: 'main', startCommand: 'npm run dev', testCommand: 'npm test' },
    }),

    // ---- tickets (Jira project CTX) ------------------------------------------------
    at({ id: 't-ctx4', kind: 'ticket', handle: 'CTX-4', title: 'Filter todos by status (all / active / done)', projectId: 'p-demo', data: { key: 'CTX-4', status: 'In Arbeit', statusCategory: 'indeterminate', type: 'Story', priority: 'Medium', assignee: me, branch: 'feature/CTX-4-filter-todos' } }),
    at({ id: 't-ctx5', kind: 'ticket', handle: 'CTX-5', title: 'Clear all completed todos', projectId: 'p-demo', data: { key: 'CTX-5', status: 'In Arbeit', statusCategory: 'indeterminate', type: 'Story', priority: 'Medium', assignee: me, branch: 'feature/CTX-5-clear-completed' } }),
    at({
      id: 't-ctx6',
      kind: 'ticket',
      handle: 'CTX-6',
      title: 'Empty or whitespace-only title creates a blank todo',
      projectId: 'p-demo',
      data: { key: 'CTX-6', status: 'In Arbeit', statusCategory: 'indeterminate', type: 'Bug', priority: 'Medium', assignee: me, branch: 'bugfix/CTX-6-reject-blank-titles' },
    }),
    at({ id: 't-ctx8', kind: 'ticket', handle: 'CTX-8', title: 'Dark mode that follows the OS setting', projectId: 'p-demo', data: { key: 'CTX-8', status: 'Selected for Development', statusCategory: 'new', type: 'Story', priority: 'Medium', assignee: me, branch: 'feature/CTX-8-dark-mode' } }),
    at({ id: 't-ctx9', kind: 'ticket', handle: 'CTX-9', title: 'Server answers 500 on malformed JSON body', projectId: 'p-demo', data: { key: 'CTX-9', status: 'Selected for Development', statusCategory: 'new', type: 'Bug', priority: 'Medium', assignee: me } }),
    at({ id: 't-ctx10', kind: 'ticket', handle: 'CTX-10', title: 'Due dates for todos', projectId: 'p-demo', data: { key: 'CTX-10', status: 'Backlog', statusCategory: 'new', type: 'Story', priority: 'Medium' } }),

    // ---- worktrees ------------------------------------------------------------------
    at({ id: 'w-ctx4', kind: 'worktree', handle: 'wt/CTX-4', title: 'feature/CTX-4-filter-todos', projectId: 'p-demo', data: { path: wt('CTX-4-filter-todos'), branch: 'feature/CTX-4-filter-todos', baseBranch: 'main', ticketKey: 'CTX-4', git: { ahead: 1, behind: 0, dirty: false, changedFiles: 0 } } }),
    at({ id: 'w-ctx5', kind: 'worktree', handle: 'wt/CTX-5', title: 'feature/CTX-5-clear-completed', projectId: 'p-demo', data: { path: wt('CTX-5-clear-completed'), branch: 'feature/CTX-5-clear-completed', baseBranch: 'feature/CTX-4-filter-todos', ticketKey: 'CTX-5', git: { ahead: 1, behind: 0, dirty: false, changedFiles: 0 } } }),
    at({ id: 'w-ctx6', kind: 'worktree', handle: 'wt/CTX-6', title: 'bugfix/CTX-6-reject-blank-titles', projectId: 'p-demo', data: { path: wt('CTX-6-reject-blank-titles'), branch: 'bugfix/CTX-6-reject-blank-titles', baseBranch: 'main', ticketKey: 'CTX-6', git: { ahead: 1, behind: 0, dirty: false, changedFiles: 0 } } }),
    at({ id: 'w-ctx8', kind: 'worktree', handle: 'wt/CTX-8', title: 'feature/CTX-8-dark-mode', projectId: 'p-demo', data: { path: wt('CTX-8-dark-mode'), branch: 'feature/CTX-8-dark-mode', baseBranch: 'main', ticketKey: 'CTX-8', git: { ahead: 1, behind: 0, dirty: false, changedFiles: 0 } } }),

    // ---- pull requests ----------------------------------------------------------------
    at({
      id: 'pr-1',
      kind: 'pr',
      handle: 'PR-1',
      title: 'CTX-4: Filter todos by status',
      projectId: 'p-demo',
      data: { repo: DEMO_REPO, number: 1, headBranch: 'feature/CTX-4-filter-todos', baseBranch: 'main', state: 'open', isDraft: false, author: 'sweedee', mergeable: 'MERGEABLE', checks: { state: 'success', passed: 3 }, additions: 43, deletions: 4 },
    }),
    at({
      id: 'pr-2',
      kind: 'pr',
      handle: 'PR-2',
      title: 'CTX-5: Clear completed todos',
      projectId: 'p-demo',
      data: { repo: DEMO_REPO, number: 2, headBranch: 'feature/CTX-5-clear-completed', baseBranch: 'feature/CTX-4-filter-todos', state: 'open', isDraft: false, author: 'sweedee', mergeable: 'MERGEABLE', checks: { state: 'success', passed: 3 }, additions: 19, deletions: 2, stackedOn: 'pr-1' },
    }),
    at({
      id: 'pr-3',
      kind: 'pr',
      handle: 'PR-3',
      title: 'CTX-6: Reject blank todo titles',
      projectId: 'p-demo',
      notice: { text: 'Checks failed: test', tone: 'critical', at: ago(25) },
      data: { repo: DEMO_REPO, number: 3, headBranch: 'bugfix/CTX-6-reject-blank-titles', baseBranch: 'main', state: 'open', isDraft: false, author: 'sweedee', mergeable: 'MERGEABLE', checks: { state: 'failure', passed: 1, failed: 1 }, additions: 13, deletions: 0 },
    }),

    // ---- CI (GitHub Actions jobs of the PRs) ---------------------------------------------
    at({
      id: 'b-pr3-test',
      kind: 'build',
      handle: 'ci/PR-3-test',
      title: 'test · PR 3',
      projectId: 'p-demo',
      data: { repo: DEMO_REPO, name: 'test', url: runUrl('43606772140', '132482994542'), runId: '43606772140', number: 4, state: 'completed', conclusion: 'failure', prNumber: 3, branch: 'bugfix/CTX-6-reject-blank-titles', stage: 'test', trigger: 'pull_request' },
    }),
    at({
      id: 'b-pr1-build',
      kind: 'build',
      handle: 'ci/PR-1-build',
      title: 'build · PR 1',
      projectId: 'p-demo',
      data: { repo: DEMO_REPO, name: 'build', url: runUrl('43606765607', '132483019178'), runId: '43606765607', number: 2, state: 'completed', conclusion: 'success', prNumber: 1, branch: 'feature/CTX-4-filter-todos', trigger: 'pull_request' },
    }),

    // ---- app, test run ---------------------------------------------------------------
    at({ id: 'app-ctx4', kind: 'app', handle: 'app/CTX-4', title: 'cortex-demo (CTX-4)', projectId: 'p-demo', data: { command: 'npm start', cwd: wt('CTX-4-filter-todos'), url: 'http://localhost:4173', port: 4173, state: 'stopped', worktreeId: 'w-ctx4' } }, 30),
    at(
      {
        id: 'tr-ctx6',
        kind: 'testrun',
        handle: 'tests/CTX-6',
        title: 'npm test · CTX-6',
        projectId: 'p-demo',
        data: {
          command: 'npm test',
          cwd: wt('CTX-6-reject-blank-titles'),
          state: 'failed',
          summary: { passed: 4, failed: 1, skipped: 0 },
          worktreeId: 'w-ctx6',
          startedAt: ago(26),
          endedAt: ago(26),
          outputTail: '✖ rejects missing, empty and blank titles (CTX-6)\n  AssertionError [ERR_ASSERTION]: expected 400 for {"title":"   "}\nℹ tests 5\nℹ pass 4\nℹ fail 1',
        },
      },
      26,
    ),

    // ---- todos -----------------------------------------------------------------------
    at({ id: 'todo-contrast', kind: 'todo', handle: 'todo/contrast-ctx8', title: 'Check dark-mode contrast', projectId: 'p-demo', data: { body: '# Check dark-mode contrast\n\n- [ ] muted text on --bg (AA)\n- [ ] focus ring visible in dark mode\n- [ ] screenshot both themes for the PR', done: false } }),
  ];

  let n = 0;
  const link = (from: string, to: string, label: string): Link => ({ id: `l${++n}`, from, to, label });
  const links: Link[] = [
    link('t-ctx4', 'p-demo', 'in project'),
    link('t-ctx5', 'p-demo', 'in project'),
    link('t-ctx6', 'p-demo', 'in project'),
    link('t-ctx8', 'p-demo', 'in project'),
    link('t-ctx9', 'p-demo', 'in project'),
    link('t-ctx10', 'p-demo', 'in project'),
    link('w-ctx4', 't-ctx4', 'works on'),
    link('w-ctx5', 't-ctx5', 'works on'),
    link('w-ctx6', 't-ctx6', 'works on'),
    link('w-ctx8', 't-ctx8', 'works on'),
    link('pr-1', 'w-ctx4', 'from branch'),
    link('pr-2', 'w-ctx5', 'from branch'),
    link('pr-2', 'pr-1', 'stacked on'),
    link('pr-3', 'w-ctx6', 'from branch'),
    link('b-pr3-test', 'pr-3', 'checks'),
    link('b-pr1-build', 'pr-1', 'checks'),
    link('app-ctx4', 'w-ctx4', 'runs'),
    link('tr-ctx6', 'w-ctx6', 'tests'),
    link('todo-contrast', 't-ctx8', 'for'),
  ];
  return { items, links };
}

export function emptyWorld(now = Date.now()): World {
  return {
    items: [
      {
        id: 'todo-welcome',
        kind: 'todo',
        handle: 'todo/welcome',
        title: 'Add your first project',
        createdAt: now,
        updatedAt: now,
        data: {
          body: '# Add your first project\n\n- [ ] Right-click the canvas → *Add to canvas* → **Add project…** and pick a repo’s main checkout\n- [ ] Select the project: **New worktree…** (optionally for a Jira ticket)\n- [ ] Type in the chat box and `@mention` the worktree to start Claude Code\n\nJira comes from the Atlassian CLI (`acli jira auth login`); GitHub from `gh auth login`.',
          done: false,
        },
      } as Item,
    ],
    links: [],
  };
}

/** The demo when its checkout is on this machine, else the empty world. */
export async function firstRunWorld(): Promise<World & { kind: 'demo' | 'empty' }> {
  try {
    const info = await native.app.info();
    if (info.home && (await native.git.isRepo(demoBaseDir(info.home)))) return { kind: 'demo', ...demoWorld(info.home) };
  } catch {
    // browser fallback / no git: empty
  }
  return { kind: 'empty', ...emptyWorld() };
}
