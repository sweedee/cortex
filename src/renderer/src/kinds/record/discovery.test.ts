import { beforeEach, describe, expect, it, vi } from 'vitest';

const files: Record<string, string> = {
  'C:\\code\\r\\records\\feat\\CTX-9-x\\plan.md': '- [x] one\n- [ ] two',
  'C:\\code\\r\\records\\feat\\CTX-9-x\\grill.md': '# grill',
  'C:\\code\\r\\records\\feat\\CTX-9-x\\notes.md': 'ignored',
};

vi.mock('../../native', () => ({
  isDesktop: true,
  native: {
    fs: {
      list: async (_dir: string, opts?: { glob?: string }) =>
        opts?.glob === 'records'
          ? [{ path: 'C:\\code\\r\\records', name: 'records', isDir: true }]
          : Object.keys(files).map((path) => ({ path, name: path.replace('C:\\code\\r\\records\\', '').replace(/\\/g, '/'), isDir: false })),
      readText: async (p: string) => files[p],
      watch: async () => 'w1',
      unwatch: async () => {},
      onChanged: () => () => {},
    },
  },
}));

import { addItem, getState, makeItem, replaceWorld } from '../../store';
import { scanProject } from './discovery';

describe('record discovery', () => {
  beforeEach(() => {
    replaceWorld([], []);
  });

  it('adds records once, links them to the ticket, and refreshes on rescan', async () => {
    const project = addItem(makeItem({ kind: 'project', handle: 'r', title: 'r', data: { repo: 'o/r', defaultBranch: 'main', baseDir: 'C:\\code\\r' } }));
    const ticket = addItem(makeItem({ kind: 'ticket', handle: 'CTX-9', title: 'T', data: { key: 'CTX-9', status: 'Open', statusCategory: 'new', type: 'Story', branch: 'feat/CTX-9-x' } }));
    expect(await scanProject(project as never)).toBe(2);
    const records = () => getState().items.filter((i) => i.kind === 'record');
    expect(records().map((r) => r.handle).sort()).toEqual(['grill.md', 'plan.md']);
    expect(getState().links.filter((l) => l.to === ticket.id).map((l) => l.label).sort()).toEqual(['grill for', 'plan for']);

    // second scan: no duplicates; a changed file updates the step count
    files['C:\\code\\r\\records\\feat\\CTX-9-x\\plan.md'] = '- [x] one\n- [x] two';
    await scanProject(project as never);
    expect(records()).toHaveLength(2);
    const plan = records().find((r) => r.handle === 'plan.md');
    expect(plan && plan.kind === 'record' && plan.data.steps).toEqual({ done: 2, total: 2 });
    expect(getState().links).toHaveLength(2);
  });
});
