import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { ItemSchema, KINDS, type ItemOf } from '../domain';
import { SEED_ITEMS, SEED_LINKS } from '../testing/fakeWorld';
import { makeItem } from '../store';
import { agentRing } from './agent';
import { prRing } from './pr';
import { recordRing } from './record';
import { actionsForItem, getKind, makeCtx, MODULES, viewOf } from './registry';
import type { KindModule } from './types';
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
      for (const fn of ['ring', 'facts', 'subtitle', 'actions', 'describe'] as const) expect(typeof m[fn], `${k}.${fn}`).toBe('function');
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

  it('every addable kind creates a schema-valid item from its example', () => {
    const proj = seed('p-ingest', 'project');
    for (const k of KINDS) {
      const add = getKind(k).addable;
      if (!add) continue;
      const it = makeItem(add.create(add.example, proj));
      const r = ItemSchema.safeParse(it);
      expect(r.success, `${k}: ${r.error?.message}`).toBe(true);
      expect(it.kind).toBe(k);
    }
  });

  it('a kind that detects pasted references recognises its example (and no earlier kind takes it)', () => {
    const detect = (v: string) => KINDS.find((k) => getKind(k).addable?.detect?.(v));
    const detecting = KINDS.filter((k) => getKind(k).addable?.detect);
    expect(detecting.length).toBeGreaterThan(0);
    expect(detecting.map((k) => detect(getKind(k).addable!.example))).toEqual(detecting);
  });

  it('describes every seed item for the chat context, without holes', () => {
    for (const it of SEED_ITEMS) {
      const text = (getKind(it.kind) as unknown as KindModule).describe(it, ctx);
      expect(text, it.id).toBeTruthy();
      expect(text, it.id).not.toMatch(/undefined|null|\(\)/);
    }
  });

  it('only real items get refresh jobs, and job ids are unique per item', () => {
    for (const it of SEED_ITEMS) {
      const jobs = (getKind(it.kind) as unknown as KindModule).sync?.(it) ?? [];
      for (const j of jobs) expect(typeof j.run, it.id).toBe('function');
      expect(new Set(jobs.map((j) => j.id)).size, it.id).toBe(jobs.length);
    }
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
