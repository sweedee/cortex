import { describe, expect, it } from 'vitest';
import { SEED_ITEMS, SEED_LINKS } from '../seed';
import v0 from './fixtures/workspace-v0.json';
import { DEFAULT_PREFS, migrate, parseWorkspace } from './migrations';
import { WORKSPACE_VERSION, WorkspaceSchema } from './schemas';
import type { Item, ItemOf, Kind } from './types';

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
    expect(get('a-plan-4833', 'agent').data.pendingQuestion?.questions[0].question).toMatch(/Dedup window/);
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
    expect(migrate({ items, links }).version).toBe(1);
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
    const r = parseWorkspace({ ...current, items: [...SEED_ITEMS, bad, SEED_ITEMS[1]], prefs: { soundOn: false, filter: { hiddenKinds: ['plan'] } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workspace.items).toHaveLength(SEED_ITEMS.length);
    expect(r.warnings.filter((w) => w.startsWith('dropped'))).toHaveLength(2);
    // the outdated filter goes, the rest of the prefs survives
    expect(r.workspace.prefs).toEqual({ ...DEFAULT_PREFS, soundOn: false, filter: undefined });
  });
});
