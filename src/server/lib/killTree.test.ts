import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('killTree (POSIX escalation)', () => {
  it('SIGTERMs the group, then SIGKILLs it when it is still alive after the grace period', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { killTree } = await import('./killTree');
    killTree(4242, { graceMs: 1000 });
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
    vi.advanceTimersByTime(1000);
    expect(kill).toHaveBeenCalledWith(-4242, 0); // liveness probe
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('does not SIGKILL a tree that exited', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, sig) => {
      if (sig === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    const { killTree } = await import('./killTree');
    killTree(4242, { graceMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(kill).not.toHaveBeenCalledWith(-4242, 'SIGKILL');
  });

  it('kills synchronously with SIGKILL on quit', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const { killTree } = await import('./killTree');
    killTree(7, { sync: true });
    expect(kill).toHaveBeenCalledWith(-7, 'SIGKILL');
  });
});
