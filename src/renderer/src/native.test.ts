import { describe, expect, it } from 'vitest';
import { eventChannels, invokeChannels } from '../../shared/ipc';
import { browserFallback, browserFallbacks } from './native';

describe('browser fallback', () => {
  it('says what every channel does without the desktop app', () => {
    const f = browserFallbacks();
    expect(Object.keys(f.invoke).sort()).toEqual(Object.keys(invokeChannels).sort());
    expect(Object.keys(f.events).sort()).toEqual(Object.keys(eventChannels).sort());
  });

  it('rejects desktop-only channels and answers the rest', async () => {
    const api = browserFallback();
    await expect(api.gh.prView({ repo: 'o/r', number: 1 })).rejects.toThrow(/gh:prView needs the Cortex desktop app/);
    expect(await api.claude.list()).toEqual([]);
    expect(await api.dialog.pickDirectory()).toBeNull();
    expect(typeof api.fs.onChanged(() => {})).toBe('function');
  });
});
