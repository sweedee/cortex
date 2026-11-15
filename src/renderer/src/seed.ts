/**
 * The first-run world.
 *
 * - **Empty** (`emptyWorld`): what a new user sees. The canvas shows a welcome panel (`overlays/Welcome.tsx`)
 *   with "Add a project" and an optional "Load demo world".
 * - **Demo** (`demoWorld`): a small made-up world for looking around. It never touches the filesystem or the
 *   network: the repo is `unknown/demo` (the convention for "no GitHub repo", skipped by the refreshers),
 *   there is no checkout, and the tickets are static. Nothing in it refers to a real person or repo.
 *
 * `firstRunWorld()` is the empty one; "Reset workspace" uses it too.
 */
import { DEMO_REPO, type Item, type Link, type NewItem } from './domain';

export { DEMO_REPO };

export interface World {
  items: Item[];
  links: Link[];
}

export function demoWorld(now = Date.now()): World {
  const ago = (min: number) => now - min * 60_000;
  const at = (n: NewItem & { id: string }, createdMinAgo = 60 * 3): Item => ({ ...n, createdAt: ago(createdMinAgo), updatedAt: ago(Math.min(createdMinAgo, 20)) }) as Item;
  const me = 'Demo User';
  const pr = { repo: DEMO_REPO, state: 'open' as const, isDraft: false, author: 'demo-user', mergeable: 'MERGEABLE' as const };

  const items: Item[] = [
    at({ id: 'p-demo', kind: 'project', handle: 'demo', title: 'demo', data: { repo: DEMO_REPO, defaultBranch: 'main', startCommand: 'npm start', testCommand: 'npm test' } }),
    at({ id: 't-demo1', kind: 'ticket', handle: 'DEMO-1', title: 'Filter todos by status', projectId: 'p-demo', data: { key: 'DEMO-1', status: 'In Progress', statusCategory: 'indeterminate', type: 'Story', priority: 'Medium', assignee: me } }),
    at({ id: 't-demo2', kind: 'ticket', handle: 'DEMO-2', title: 'Blank title creates an empty todo', projectId: 'p-demo', data: { key: 'DEMO-2', status: 'In Progress', statusCategory: 'indeterminate', type: 'Bug', priority: 'Medium', assignee: me } }),
    at({ id: 't-demo3', kind: 'ticket', handle: 'DEMO-3', title: 'Due dates for todos', projectId: 'p-demo', data: { key: 'DEMO-3', status: 'Backlog', statusCategory: 'new', type: 'Story', priority: 'Low' } }),
    at({ id: 'pr-1', kind: 'pr', handle: 'PR-1', title: 'DEMO-1: Filter todos by status', projectId: 'p-demo', data: { ...pr, number: 1, headBranch: 'feature/DEMO-1-filter', baseBranch: 'main', checks: { state: 'success', passed: 3 }, additions: 43, deletions: 4 } }),
    at({
      id: 'pr-2',
      kind: 'pr',
      handle: 'PR-2',
      title: 'DEMO-2: Reject blank titles',
      projectId: 'p-demo',
      notice: { text: 'Checks failed: test', tone: 'critical', at: ago(25) },
      data: { ...pr, number: 2, headBranch: 'bugfix/DEMO-2-blank-titles', baseBranch: 'main', checks: { state: 'failure', passed: 1, failed: 1 }, additions: 13, deletions: 0 },
    }),
    at({
      id: 'todo-demo',
      kind: 'todo',
      handle: 'todo/demo-world',
      title: 'This is a demo world',
      projectId: 'p-demo',
      data: { body: '# This is a demo world\n\nEverything here is made up and static. Add your own project (right-click the canvas → *Add to canvas* → **Add project…**), then use *Reset workspace* in the settings to clear this.', done: false },
    }),
  ];

  let n = 0;
  const link = (from: string, to: string, label: Link['label']): Link => ({ id: `l${++n}`, from, to, label });
  const links: Link[] = [
    link('t-demo1', 'p-demo', 'in project'),
    link('t-demo2', 'p-demo', 'in project'),
    link('t-demo3', 'p-demo', 'in project'),
    link('pr-1', 't-demo1', 'implements'),
    link('pr-2', 't-demo2', 'implements'),
    link('todo-demo', 'p-demo', 'for'),
  ];
  return { items, links };
}

/** A new user's world: nothing yet (the canvas shows the welcome panel). */
export const emptyWorld = (): World => ({ items: [], links: [] });

export const firstRunWorld = (): World => emptyWorld();
