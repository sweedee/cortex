import { describe, expect, it } from 'vitest';
import type { ProcExitEvent } from '../../shared/ipc';
import { ProcManager } from './procManager';

function manager() {
  const out: string[] = [];
  let onExit: (e: ProcExitEvent) => void = () => {};
  const exited = new Promise<ProcExitEvent>((r) => (onExit = r));
  const pm = new ProcManager((channel, payload) => {
    if (channel === 'proc:output') out.push((payload as { chunk: string }).chunk);
    else onExit(payload as ProcExitEvent);
  });
  return { pm, out, exited };
}

describe('ProcManager', () => {
  it('streams output and reports the exit', async () => {
    const { pm, out, exited } = manager();
    pm.start({ id: 'p', cmd: 'node', args: ['-e', 'console.log("hello")'], cwd: process.cwd() });
    expect(pm.list().map((p) => p.id)).toEqual(['p']);
    expect((await exited).code).toBe(0);
    expect(out.join('')).toContain('hello');
    expect(pm.list()).toEqual([]);
  });

  it('runs user commands through the shell when asked', async () => {
    const { pm, out, exited } = manager();
    pm.start({ id: 's', cmd: 'node -e "console.log(1+1)"', args: [], cwd: process.cwd(), shell: true });
    expect((await exited).code).toBe(0);
    expect(out.join('').trim()).toBe('2');
  });

  it('stops the whole tree', async () => {
    const { pm, exited } = manager();
    // a parent that spawns a grandchild and both idle
    const script = 'require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" }); setInterval(()=>{},1000)';
    pm.start({ id: 'tree', cmd: 'node', args: ['-e', script], cwd: process.cwd() });
    expect(() => pm.start({ id: 'tree', cmd: 'node', args: [], cwd: process.cwd() })).toThrow(/already running/);
    await new Promise((r) => setTimeout(r, 300));
    expect(pm.stop('tree')).toBe(true);
    const e = await exited;
    expect(e.code === 0).toBe(false);
    expect(pm.stop('tree')).toBe(false);
  }, 15_000);
});
