import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parseWorkspace, WORKSPACE_VERSION } from './domain';
import { isLinkLabel } from './domain/links';
import { demoWorld, emptyWorld, firstRunWorld } from './seed';

describe('first-run worlds', () => {
  it('the demo world is a valid, self-contained workspace with nothing personal in it', () => {
    const w = demoWorld(0);
    const r = parseWorkspace({ version: WORKSPACE_VERSION, items: w.items, links: w.links, prefs: DEFAULT_PREFS });
    expect(r.ok && r.warnings).toEqual([]);
    const ids = new Set(w.items.map((i) => i.id));
    expect(w.links.every((l) => ids.has(l.from) && ids.has(l.to) && isLinkLabel(l.label))).toBe(true);
    const text = JSON.stringify(w);
    expect(text).not.toMatch(/sweedee|Documents|Users/i);
    // no checkout and no GitHub repo: the refreshers skip it, nothing touches disk or network
    expect(w.items.flatMap((i) => ('repo' in i.data ? [i.data.repo] : []))).toEqual(expect.arrayContaining(['unknown/demo']));
    expect(w.items.some((i) => i.kind === 'worktree' || (i.kind === 'project' && i.data.baseDir))).toBe(false);
  });

  it('a new user starts with an empty world', () => {
    expect(emptyWorld()).toEqual({ items: [], links: [] });
    expect(firstRunWorld()).toEqual({ items: [], links: [] });
    expect(parseWorkspace({ version: WORKSPACE_VERSION, items: [], links: [] }).ok).toBe(true);
  });
});
