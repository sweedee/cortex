import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { ItemSchema, KINDS, type ItemOf } from '../domain';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import { makeItem } from '../store';
import { agentRing } from './agent';
import { prRing } from './pr';
import { recordRing } from './record';
import { actionsForItem, getKind, makeCtx, MODULES, viewOf } from './registry';
import { testrunRing } from './testrun';
import { worktreeRing } from './worktree';

const ctx = makeCtx(SEED_ITEMS, SEED_LINKS);
const seed = <K extends keyof typeof MODULES>(id: string, kind: K) => {
  const it = SEED_ITEMS.find((i) => i.id === id);
  if (it?.kind !== kind) throw new Error(`seed ${id} is not a ${kind}`);
  return it as ItemOf<K>;
};

describe('kind registry', () => {
  it('has a complete module for every kind', () => {
    expect(Object.keys(MODULES).sort()).toEqual([...KINDS].sort());
    for (const k of KINDS) {
      const m = getKind(k);
      expect(m.kind, k).toBe(k);
      expect(m.label, k).toBeTruthy();
      expect(m.radius, k).toBeGreaterThan(10);
      expect(m.level, k).toBeGreaterThanOrEqual(0);
      expect(isValidElement(m.icon(16)), k).toBe(true);
      for (const fn of ['ring', 'facts', 'subtitle', 'actions'] as const) expect(typeof m[fn], `${k}.${fn}`).toBe('function');
    }
    expect(KINDS.filter((k) => getKind(k).level === 0)).toEqual(['project']);
  });

  it('the seed has at least one item of every kind', () => {
    for (const k of KINDS) expect(SEED_ITEMS.some((i) => i.kind === k), k).toBe(true);
  });

  it('derives a view and actions for every seed item', () => {
    for (const it of SEED_ITEMS) {
      const v = viewOf(it, ctx);
      expect(v.ring.length, it.id).toBeGreaterThan(0);
      expect(v.ring.every((s) => s.label && (s.weight ?? 1) > 0), it.id).toBe(true);
      const actions = actionsForItem(it, ctx);
      expect(actions.length, it.id).toBeGreaterThan(0);
      expect(new Set(actions.map((a) => a.id)).size, `${it.id}: unique action ids`).toBe(actions.length);
      expect(actions.some((a) => a.id === 'archive'), it.id).toBe(true);
    }
  });

  it('archived items only offer unarchive plus viewing', () => {
    const a = actionsForItem({ ...seed('b-1838', 'build'), archived: true }, ctx);
    expect(a[0].id).toBe('unarchive');
    expect(a.every((x) => x.id === 'unarchive' || x.type === 'view' || x.type === 'external')).toBe(true);
  });

  it('every addable kind creates a schema-valid item', () => {
    const proj = seed('p-ingest', 'project');
    for (const k of KINDS) {
      const add = getKind(k).addable;
      if (!add) continue;
      const it = makeItem(add.create(k === 'pr' ? 'owner/repo#12' : k === 'ticket' ? 'CTX-1' : 'feat/CTX-1-x', proj));
      const r = ItemSchema.safeParse(it);
      expect(r.success, `${k}: ${r.error?.message}`).toBe(true);
      expect(it.kind).toBe(k);
    }
  });

  it('detects pasted references', () => {
    const detect = (v: string) => KINDS.find((k) => getKind(k).addable?.detect?.(v));
    expect(detect('CTX-1234')).toBe('ticket');
    expect(detect('https://github.com/o/r/pull/12')).toBe('pr');
    expect(detect('feat/CTX-1-x')).toBe('worktree');
    expect(detect('PLAN-CTX-1.md')).toBe('record');
    expect(detect('https://dev.example.com')).toBe('deployment');
  });
});

describe('ring derivation', () => {
  it('pr: approved but conflicting and failing shows all three', () => {
    expect(prRing(seed('pr-477', 'pr')).map((s) => s.tone)).toEqual(['success', 'warning', 'critical']);
    expect(prRing(seed('pr-469', 'pr'))).toEqual([{ tone: 'success', label: 'Approved, checks green, mergeable' }]);
    expect(prRing({ ...seed('pr-469', 'pr'), data: { ...seed('pr-469', 'pr').data, state: 'merged' } })).toEqual([{ tone: 'success', label: 'Merged' }]);
    expect(prRing(seed('pr-482', 'pr')).map((s) => s.tone)).toEqual(['neutral', 'running']);
  });

  it('worktree: behind and dirty', () => {
    expect(worktreeRing(seed('w-4790', 'worktree'))).toEqual([{ tone: 'warning', label: '12 commits behind main' }]);
    expect(worktreeRing(seed('w-4821', 'worktree')).map((s) => [s.tone, s.weight])).toEqual([
      ['success', 2],
      ['warning', 1],
    ]);
    expect(worktreeRing({ ...seed('w-4821', 'worktree'), data: { ...seed('w-4821', 'worktree').data, git: undefined } })[0].tone).toBe('neutral');
  });

  it('agent, record, testrun, deployment, ticket', () => {
    expect(agentRing(seed('a-plan-4833', 'agent'))[0].tone).toBe('warning');
    expect(viewOf(seed('a-plan-4833', 'agent'), ctx).waiting).toBe(true);
    expect(viewOf(seed('a-impl-4821', 'agent'), ctx).running).toBe(true);
    expect(recordRing(seed('plan-4821', 'record')).map((s) => [s.tone, s.weight])).toEqual([
      ['success', 4],
      ['neutral', 2],
    ]);
    expect(testrunRing(seed('tr-4821', 'testrun')).map((s) => s.tone)).toEqual(['critical', 'success', 'neutral']);
    expect(viewOf(seed('d-ingest-prod', 'deployment'), ctx).badge).toEqual({ label: 'prod', tone: 'critical' });
    expect(viewOf(seed('t-4802', 'ticket'), ctx).ring).toEqual([{ tone: 'critical', label: 'Blocker · To Do' }]);
  });

  it('project ring and facts use related items via ctx', () => {
    const p = seed('p-console', 'project');
    expect(viewOf(p, ctx).ring.map((s) => s.tone)).toEqual(['success', 'warning']);
    expect(getKind('project').facts(p, ctx)).toContainEqual(['Worktrees', '1']);
    expect(getKind('project').facts(seed('p-ingest', 'project'), ctx)).toContainEqual(['Deployments', '2']);
  });
});
