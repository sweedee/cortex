import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parseWorkspace, WORKSPACE_VERSION } from './domain';
import { isOldFakeDemo } from './persist';
import { demoBaseDir, demoWorld, emptyWorld } from './seed';
import { SEED_ITEMS } from './testing/fakeWorld';

describe('first-run worlds', () => {
  it('the demo world is a valid workspace with absolute, real-looking paths', () => {
    const w = demoWorld('C:\\Users\\me', 0);
    const r = parseWorkspace({ version: WORKSPACE_VERSION, items: w.items, links: w.links, prefs: DEFAULT_PREFS });
    expect(r.ok && r.warnings).toEqual([]);
    const ids = new Set(w.items.map((i) => i.id));
    expect(w.links.every((l) => ids.has(l.from) && ids.has(l.to))).toBe(true);
    expect(demoBaseDir('C:\\Users\\me')).toBe('C:\\Users\\me\\Documents\\cortex-demo');
    const wt = w.items.find((i) => i.id === 'w-ctx4');
    expect(wt?.kind === 'worktree' && wt.data.path).toBe('C:\\Users\\me\\Documents\\wt\\cortex-demo\\CTX-4-filter-todos');
    expect(demoWorld('/home/me').items.find((i) => i.id === 'p-demo')).toMatchObject({ data: { baseDir: '/home/me/Documents/cortex-demo' } });
    // nothing fake: every repo is a real one
    expect(w.items.flatMap((i) => ('repo' in i.data ? [i.data.repo] : []))).toEqual(expect.arrayContaining(['sweedee/cortex-demo', 'sweedee/cortex']));
    expect(isOldFakeDemo(w.items)).toBe(false);
  });

  it('the empty world has a welcome todo; the old fake demo is recognised', () => {
    const e = emptyWorld(0);
    expect(parseWorkspace({ version: WORKSPACE_VERSION, items: e.items, links: e.links }).ok).toBe(true);
    expect(e.items.map((i) => i.kind)).toEqual(['todo']);
    expect(isOldFakeDemo(SEED_ITEMS)).toBe(true);
    expect(isOldFakeDemo([])).toBe(false);
  });
});
