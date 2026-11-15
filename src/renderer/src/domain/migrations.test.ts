import { describe, expect, it } from 'vitest';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import v0 from './fixtures/workspace-v0.json';
import v1 from './fixtures/workspace-v1.json';
import v3 from './fixtures/workspace-v3.json';
import { DEFAULT_PREFS, migrate, movedPrefsPatch, parseWorkspace } from './migrations';
import { KindSchema, WORKSPACE_VERSION, WorkspaceSchema } from './schemas';
import type { Item, ItemOf, Kind } from './types';
import { must } from '../testing/must';

describe('migration v0 → v1 (phase-0a seed)', () => {
  const r = parseWorkspace(v0);
  if (!r.ok) throw new Error(r.error);
  const items = new Map<string, Item>(r.workspace.items.map((i) => [i.id, i]));
  const get = <K extends Kind>(id: string, kind: K) => {
    const it = items.get(id);
    expect(it?.kind, id).toBe(kind);
    return it as ItemOf<K>;
  };

  it('maps every old item and keeps every link', () => {
    expect(r.migrated).toBe(true);
    expect(r.workspace.version).toBe(WORKSPACE_VERSION);
    expect(r.workspace.items).toHaveLength(v0.items.length);
    expect(r.workspace.links).toHaveLength(v0.links.length);
    expect(r.warnings.filter((w) => w.startsWith('dropped'))).toEqual([]);
    expect(r.workspace.prefs).toEqual(DEFAULT_PREFS);
  });

  it('turns display strings into typed data', () => {
    expect(get('p-console', 'project').data).toMatchObject({ repo: 'ctx-observability/console-ui', defaultBranch: 'main', stats: { mainChecks: 'success', openPrs: 5, renovatePrs: 4 } });
    expect(get('t-4802', 'ticket').data).toMatchObject({ key: 'CTX-4802', type: 'Bug', priority: 'Blocker', status: 'To Do', statusCategory: 'new', points: 2 });
    expect(get('t-4802', 'ticket').data.assignee).toBeUndefined();
    expect(get('w-4790', 'worktree').data).toMatchObject({
      path: '~/wt/console-ui/CTX-4790',
      branch: 'fix/CTX-4790-tile-flicker',
      ticketKey: 'CTX-4790',
      git: { ahead: 3, behind: 12, changedFiles: 0, dirty: false },
    });
    expect(get('a-plan-4833', 'agent').data).toMatchObject({ status: 'waiting', model: 'claude-opus-5-5', usage: { contextPct: 34, costUsd: 0.62, turns: 9 } });
    expect(get('a-plan-4833', 'agent').data.pendingQuestion?.questions[0]?.question).toMatch(/Dedup window/);
    expect(get('a-impl-4821', 'agent').data).toMatchObject({ status: 'running', lastActivity: 'editing src/dispatcher/retry.ts' });
    expect(get('pr-477', 'pr').data).toMatchObject({
      repo: 'ctx-observability/console-ui',
      number: 477,
      reviewDecision: 'APPROVED',
      mergeable: 'CONFLICTING',
      checks: { state: 'failure' },
      additions: 96,
      deletions: 41,
    });
    expect(get('pr-469', 'pr').data).toMatchObject({ author: 'renovate[bot]', mergeable: 'MERGEABLE', isDraft: false });
    expect(get('pr-482', 'pr').data.isDraft).toBe(true);
    expect(get('b-1838', 'build').data).toMatchObject({ state: 'completed', conclusion: 'failure', stage: 'e2e', number: 1838, durationSec: 880, branch: 'fix/CTX-4790-tile-flicker' });
    expect(get('b-1842', 'build').data.state).toBe('in_progress');
    expect(get('plan-4821', 'record').data).toMatchObject({ recordType: 'plan', status: 'approved', steps: { done: 4, total: 6 }, ticketKey: 'CTX-4821' });
    expect(get('plan-4833', 'record').data).toMatchObject({ status: 'draft', steps: { done: 0, total: 9 } });
  });

  it('keeps common fields: cluster → projectId, notices get a timestamp', () => {
    const t = get('t-4840', 'ticket');
    expect(t.projectId).toBe('p-ingest');
    expect(t.notice).toMatchObject({ text: 'Assigned to you by Mara Lindqvist', tone: 'primary' });
    expect(Date.now() - t.notice!.at).toBeGreaterThanOrEqual(12 * 60_000 - 1000);
    expect(get('p-ingest', 'project').projectId).toBeUndefined();
  });

  it('drops kinds it cannot map and dangling links, with warnings', () => {
    const raw = {
      version: 0,
      items: [...v0.items, { id: 'x', kind: 'spaceship', handle: 'x', title: 'x', status: [] }, { nope: 1 }],
      links: [...v0.links, { id: 'lx', from: 'x', to: 'p-ingest', label: '' }],
    };
    const res = parseWorkspace(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.workspace.items).toHaveLength(v0.items.length);
    expect(res.workspace.links).toHaveLength(v0.links.length);
    expect(res.warnings.some((w) => w.includes('spaceship'))).toBe(true);
    expect(res.warnings.some((w) => w.includes('dangling link lx'))).toBe(true);
  });

  it('treats a file without a version as v0', () => {
    const { items, links } = v0;
    expect(migrate({ items, links }).version).toBe(WORKSPACE_VERSION);
  });
});

describe('migration v1 → v2 (phase-2b settings)', () => {
  const r = parseWorkspace(v1);
  if (!r.ok) throw new Error(r.error);

  it('adds the new prefs with their defaults and keeps the old ones (the user settings move on in v4)', () => {
    expect(r.migrated).toBe(true);
    expect(r.workspace.version).toBe(WORKSPACE_VERSION);
    expect(r.workspace.prefs).toEqual({ ...DEFAULT_PREFS, colorBy: 'ticket', sidebarWidth: 360 });
    // the v2 defaults (permission mode, refresh) are not frozen into config.json
    expect(r.movedPrefs).toEqual({ ui: { notifications: true, sound: false } });
  });

  it('keeps items and links as they are', () => {
    expect(r.warnings.filter((w) => w.startsWith('dropped'))).toEqual([]);
    expect(r.workspace.items.map((i) => i.id)).toEqual(['p-ingest', 'a-impl-4821']);
    const a = must(r.workspace.items[1]);
    expect(a.kind === 'agent' && a.data).toMatchObject({ status: 'running', skill: 'implement' });
    expect(a.kind === 'agent' && a.data.localId).toBeUndefined();
    expect(r.workspace.links).toHaveLength(1);
  });

  it('falls back to defaults for bad new prefs instead of resetting all prefs', () => {
    const bad = parseWorkspace({ ...v1, version: 2, prefs: { ...v1.prefs, refreshSec: 1, permissionMode: 'yolo', sidebarWidth: 'wide' } });
    expect(bad.ok && bad.workspace.prefs).toMatchObject({ colorBy: 'ticket', sidebarWidth: 360 });
    expect(bad.ok && bad.movedPrefs).toEqual({ ui: { notifications: true, sound: false } });
  });
});

describe('parseWorkspace', () => {
  const current = { version: WORKSPACE_VERSION, items: SEED_ITEMS, links: SEED_LINKS, prefs: { ...DEFAULT_PREFS, colorBy: 'ticket' } };

  it('round-trips the seed through JSON unchanged', () => {
    const r = parseWorkspace(JSON.parse(JSON.stringify(current)));
    expect(r.ok && r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(r.migrated).toBe(false);
    expect(r.workspace.items).toEqual(SEED_ITEMS);
    expect(r.workspace.links).toEqual(SEED_LINKS);
    expect(r.workspace.prefs.colorBy).toBe('ticket');
    expect(WorkspaceSchema.safeParse(r.workspace).success).toBe(true);
  });

  it('rejects what is not a workspace, and files from the future', () => {
    expect(parseWorkspace(null).ok).toBe(false);
    expect(parseWorkspace([]).ok).toBe(false);
    expect(parseWorkspace({ version: 1, items: 'no' }).ok).toBe(false);
    const future = parseWorkspace({ ...current, version: WORKSPACE_VERSION + 1 });
    expect(!future.ok && future.error).toMatch(/newer/);
  });

  it('drops single invalid items, duplicates and an outdated filter', () => {
    const bad = { ...SEED_ITEMS[0], id: 'bad', data: { repo: 'not a repo' } };
    const r = parseWorkspace({ ...current, items: [...SEED_ITEMS, bad, SEED_ITEMS[1]], prefs: { sidebarWidth: 500, filter: { hiddenKinds: ['plan'] } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workspace.items).toHaveLength(SEED_ITEMS.length);
    expect(r.warnings.filter((w) => w.startsWith('dropped'))).toHaveLength(2);
    // the outdated filter goes, the rest of the prefs survives
    expect(r.workspace.prefs).toEqual({ ...DEFAULT_PREFS, sidebarWidth: 500, filter: undefined });
  });
});

describe('migration v2 to v3 (filter selects kinds to show)', () => {
  const file = (filter?: object) => ({ version: 2, items: SEED_ITEMS, links: SEED_LINKS, prefs: { ...DEFAULT_PREFS, ...(filter && { filter }) } });
  const base = { status: [], projects: [], query: 'x', unreadOnly: false, showArchived: false };

  it('turns hidden kinds into the complementary list of shown kinds', () => {
    const r = parseWorkspace(file({ ...base, hiddenKinds: ['build', 'agent'] }));
    expect(r.ok && r.migrated).toBe(true);
    if (!r.ok) return;
    const f = r.workspace.prefs.filter!;
    expect(f.kinds).toHaveLength(KindSchema.options.length - 2);
    expect(f.kinds).not.toContain('build');
    expect(f.kinds).not.toContain('agent');
    expect(f.kinds).toContain('pr');
    expect(f).not.toHaveProperty('hiddenKinds');
    expect(f.query).toBe('x');
  });

  it('nothing hidden (or everything hidden) = no restriction', () => {
    for (const hiddenKinds of [[], [...KindSchema.options]]) {
      const r = parseWorkspace(file({ ...base, hiddenKinds }));
      expect(r.ok && r.workspace.prefs.filter?.kinds).toEqual([]);
    }
  });

  it('keeps a file without a filter', () => {
    const r = parseWorkspace(file());
    expect(r.ok && r.workspace.version).toBe(WORKSPACE_VERSION);
    expect(r.ok && r.workspace.prefs.filter).toBeUndefined();
  });
});

describe('migration v3 → v4 (user settings move to config.json)', () => {
  const r = parseWorkspace(v3);
  if (!r.ok) throw new Error(r.error);

  it('keeps the UI state in the workspace', () => {
    expect(r.migrated).toBe(true);
    expect(r.workspace.prefs).toEqual({ colorBy: 'ticket', sidebarWidth: 420, filter: v3.prefs.filter });
    expect(r.workspace.prefs).not.toHaveProperty('model');
    expect(r.workspace.items).toHaveLength(1);
  });

  it('hands the settings over as a config.json patch (defaults left out)', () => {
    expect(r.movedPrefs).toEqual({
      claude: { model: 'claude-opus-5-5', effort: 'high', permissionMode: 'acceptEdits' },
      github: { aiReviewComment: '/review' },
      ui: { notifications: true, sound: false },
    });
  });

  it('drops invalid and default values one by one', () => {
    expect(movedPrefsPatch({ effort: 'ludicrous', permissionMode: 'yolo', refreshSec: 5, soundOn: true, model: '', aiReviewComment: '@claude review' })).toBeUndefined();
    expect(movedPrefsPatch({ refreshSec: 120, effort: 'nope' })).toEqual({ refresh: { intervalSec: 120 } });
    expect(movedPrefsPatch(undefined)).toBeUndefined();
  });

  it('a current file has nothing to move', () => {
    const cur = parseWorkspace({ version: WORKSPACE_VERSION, items: [], links: [], prefs: DEFAULT_PREFS });
    expect(cur.ok && cur.movedPrefs).toBeUndefined();
  });
});
