import { describe, expect, it, vi } from 'vitest';
import { ModeGate } from './modeGate';

describe('ModeGate', () => {
  it('never asks for ordinary modes', async () => {
    const ask = vi.fn<(mode: string) => Promise<boolean>>(async () => false);
    const g = new ModeGate(ask);
    for (const m of [undefined, 'default', 'acceptEdits', 'plan', 'auto', 'manual']) await g.require(m);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks once per unattended mode and remembers a yes', async () => {
    const ask = vi.fn<(mode: string) => Promise<boolean>>(async () => true);
    const g = new ModeGate(ask);
    await Promise.all([g.require('bypassPermissions'), g.require('bypassPermissions')]);
    await g.require('bypassPermissions');
    expect(ask).toHaveBeenCalledTimes(1);
    await g.require('dontAsk');
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('throws on a no and asks again next time', async () => {
    const ask = vi.fn<(mode: string) => Promise<boolean>>(async () => false);
    const g = new ModeGate(ask);
    await expect(g.require('dontAsk')).rejects.toThrow(/not confirmed/);
    await expect(g.require('dontAsk')).rejects.toThrow(/not confirmed/);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
