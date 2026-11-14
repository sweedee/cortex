import { describe, expect, it, vi } from 'vitest';
import { startProgressToast } from './progressToast';

function fakeApi() {
  const timers: (() => void)[] = [];
  return {
    timers,
    show: vi.fn<(id: string) => void>(),
    dismiss: vi.fn<(id: string) => void>(),
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: (t: unknown) => {
      timers[(t as number) - 1] = () => {};
    },
  };
}

describe('progress toast', () => {
  it('never shows a spinner for quick work', () => {
    const api = fakeApi();
    const p = startProgressToast(api);
    p.finish();
    api.timers.forEach((t) => t());
    expect(api.show).not.toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
  });

  it('shows after the delay and dismisses when done', () => {
    const api = fakeApi();
    const p = startProgressToast(api);
    api.timers[0]();
    expect(api.show).toHaveBeenCalledWith(p.id);
    p.mounted();
    expect(api.dismiss).not.toHaveBeenCalled();
    p.finish();
    expect(api.dismiss).toHaveBeenCalledWith(p.id);
  });

  it('dismisses itself when it only appears (queued) after the work finished', () => {
    const api = fakeApi();
    const p = startProgressToast(api);
    api.timers[0](); // shown, but queued behind 5 open toasts: dismiss() is a no-op then
    p.finish();
    api.dismiss.mockClear();
    p.mounted(); // the queue moves on and the spinner finally renders
    expect(api.dismiss).toHaveBeenCalledWith(p.id);
  });

  it('gives every task its own id', () => {
    const api = fakeApi();
    expect(startProgressToast(api).id).not.toBe(startProgressToast(api).id);
  });
});
