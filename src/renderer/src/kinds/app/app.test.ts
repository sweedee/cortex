import { describe, expect, it } from 'vitest';
import type { ItemOf } from '../../domain';
import { makeItem } from '../../store';
import { appActions, appRing } from './index';
import { cannotStart, isLive, NO_DIR_HINT, runnerId, startRequest } from './ops';

const app = (data: Partial<ItemOf<'app'>['data']>) =>
  makeItem({ kind: 'app', handle: 'app/x', title: 'X', data: { command: 'npm run dev', cwd: 'C:\\work\\x', state: 'stopped', ...data } }) as ItemOf<'app'>;
const byId = (a: ItemOf<'app'>) => Object.fromEntries(appActions(a).map((x) => [x.id, x]));

describe('app ring', () => {
  it('maps the states to tones', () => {
    expect(appRing(app({ state: 'starting' }))[0]?.tone).toBe('running');
    expect(appRing(app({ state: 'running', url: 'http://localhost:3000' }))[0]).toEqual({ tone: 'success', label: 'Running on http://localhost:3000' });
    expect(appRing(app({ state: 'crashed' }))[0]?.tone).toBe('critical');
    expect(appRing(app({ state: 'stopped' }))[0]?.tone).toBe('neutral');
  });
});

describe('app actions', () => {
  it('stopped: start is primary, open disabled', () => {
    const a = byId(app({}));
    expect(a.start).toMatchObject({ label: 'Start', primary: true, disabled: undefined });
    expect(a.open?.disabled).toBe('Not running');
    expect(a.stop).toBeUndefined();
    expect(a.restart).toBeUndefined();
  });
  it('running with a URL: open primary, restart + stop', () => {
    const a = byId(app({ state: 'running', url: 'http://localhost:5173', procId: 'x' }));
    expect(a.open).toMatchObject({ primary: true, disabled: undefined });
    expect(a.restart).toBeDefined();
    expect(a.stop).toMatchObject({ danger: true });
    expect(a.start).toBeUndefined();
  });
  it('starting without a URL: open disabled until one is detected', () => {
    expect(byId(app({ state: 'starting' })).open?.disabled).toBe('No URL detected yet');
  });
  it('crashed: "Restart" starts again, show log is primary', () => {
    const a = byId(app({ state: 'crashed' }));
    expect(a.start?.label).toBe('Restart');
    expect(a.log?.primary).toBe(true);
  });
  it('demo item with a fake path cannot start', () => {
    const demo = app({ cwd: '~/wt/x' });
    expect(cannotStart(demo)).toBe(NO_DIR_HINT);
    expect(byId(demo).start?.disabled).toBe(NO_DIR_HINT);
    expect(byId(demo).editor).toBeUndefined();
    expect(cannotStart(app({ command: ' ' }))).toBe('No start command');
  });
  it('runner id and start request', () => {
    const a = app({});
    expect(runnerId(a)).toBe(a.id);
    expect(runnerId(app({ procId: 'p1' }))).toBe('p1');
    expect(startRequest(a)).toEqual({ id: a.id, cwd: 'C:\\work\\x', command: 'npm run dev' });
    expect([isLive(app({ state: 'starting' })), isLive(app({ state: 'crashed' }))]).toEqual([true, false]);
  });
});
