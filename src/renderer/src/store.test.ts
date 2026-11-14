import { beforeEach, describe, expect, it } from 'vitest';
import './kinds/registry'; // provides the kind info the filter needs
import { DEFAULT_PREFS } from './domain';
import { SEED_ITEMS, SEED_LINKS } from './testing/fakeWorld';
import { EMPTY_FILTER, getState, insertSkill, notify, patchData, replaceWorld, select, setArchived, setDraft, setFilter, visibleSet } from './store';

const all = SEED_ITEMS.map((i) => i.id);

beforeEach(() => {
  replaceWorld(SEED_ITEMS, SEED_LINKS, { ...DEFAULT_PREFS, filter: EMPTY_FILTER });
  setDraft('');
});

describe('visibleSet', () => {
  it('shows everything by default', () => {
    expect([...visibleSet()].sort()).toEqual([...all].sort());
  });

  it('shows only the selected kinds (none selected = all)', () => {
    setFilter({ kinds: ['build', 'agent'] });
    const v = visibleSet();
    const shown = SEED_ITEMS.filter((i) => v.has(i.id));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((i) => i.kind === 'build' || i.kind === 'agent')).toBe(true);
    expect(v.has('p-ingest')).toBe(false);
    setFilter({ kinds: [] });
    expect(visibleSet().has('p-ingest')).toBe(true);
  });

  it('filters by status group (derived from the ring)', () => {
    setFilter({ status: ['failing'] });
    expect([...visibleSet()].sort()).toEqual(['b-1838', 'pr-477', 't-4802', 'tr-4821']);
    setFilter({ status: ['attention'] });
    expect(visibleSet().has('a-plan-4833')).toBe(true);
    expect(visibleSet().has('w-4790')).toBe(true);
    expect(visibleSet().has('b-1201')).toBe(false);
  });

  it('filters by project (links and projectId)', () => {
    setFilter({ projects: ['p-alert'] });
    const v = visibleSet();
    expect(v.has('p-alert')).toBe(true);
    expect(v.has('t-4802')).toBe(true);
    expect(v.has('b-1201')).toBe(true);
    // CTX-4833 involves two projects
    expect(v.has('t-4833')).toBe(true);
    expect(v.has('p-ingest')).toBe(false);
    expect(v.has('d-ingest-dev')).toBe(false);
  });

  it('searches handle, title and the derived subtitle', () => {
    setFilter({ query: 'renovate' });
    expect(visibleSet().has('pr-469')).toBe(true); // subtitle "console-ui · renovate[bot] → main"
    expect(visibleSet().has('a-renovate')).toBe(true);
    expect(visibleSet().has('p-ingest')).toBe(false);
    setFilter({ query: '~/wt/console-ui' });
    expect([...visibleSet()]).toEqual(['w-4790']);
  });

  it('unread only, and archived items', () => {
    setFilter({ unreadOnly: true });
    expect(visibleSet().has('t-4840')).toBe(true);
    expect(visibleSet().has('t-4821')).toBe(false);
    setFilter({ unreadOnly: false });
    setArchived(['t-4821'], true);
    expect(visibleSet().has('t-4821')).toBe(false);
    setFilter({ showArchived: true });
    expect(visibleSet().has('t-4821')).toBe(true);
  });

  it('is cached while nothing relevant changes', () => {
    const a = visibleSet();
    select(['p-ingest']); // selection changes items only when it reads a notice
    expect(visibleSet()).toBe(a);
  });
});

describe('store actions', () => {
  it('patchData merges into typed data and bumps updatedAt', () => {
    const before = getState().items.find((i) => i.id === 'w-4790')!;
    patchData<'worktree'>('w-4790', { git: { ahead: 3, behind: 0, dirty: false, changedFiles: 0 } });
    const after = getState().items.find((i) => i.id === 'w-4790')!;
    expect(after.kind === 'worktree' && after.data.git?.behind).toBe(0);
    expect(after.kind === 'worktree' && after.data.branch).toBe('fix/CTX-4790-tile-flicker');
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('notify attaches an unread notice; selecting reads it', () => {
    notify('b-1201', { text: 'hi', tone: 'success' });
    expect(getState().items.find((i) => i.id === 'b-1201')!.notice).toMatchObject({ text: 'hi', read: false });
    select(['b-1201']);
    expect(getState().items.find((i) => i.id === 'b-1201')!.notice!.read).toBe(true);
  });

  it('insertSkill writes the skill and mentions into the draft', () => {
    insertSkill('rebase', ['w-4790']);
    expect(getState().draft).toBe('/rebase @wt/CTX-4790-flicker ');
  });
});
