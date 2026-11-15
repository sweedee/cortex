import { describe, expect, it } from 'vitest';
import { CliMissingError, runExec } from './exec';
import { globToRegExp } from './glob';
import { setLimits } from './limits';
import { DEFAULT_USER_CONFIG } from '../../shared/userConfig';

const cwd = process.cwd();

describe('runExec (real child processes, no shell)', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const r = await runExec({ cmd: 'node', args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'], cwd });
    expect(r).toEqual({ code: 3, stdout: 'out', stderr: 'err', timedOut: false, truncated: false });
  });

  it('passes arguments verbatim (no shell interpretation)', async () => {
    const tricky = ['a b', '"quoted"', '$HOME', '%PATH%', '& echo pwned', '|', '>out.txt'];
    const r = await runExec({ cmd: 'node', args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...tricky], cwd });
    expect(JSON.parse(r.stdout)).toEqual(tricky);
  });

  it('feeds stdin and merges env', async () => {
    const r = await runExec({ cmd: 'node', args: ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s+process.env.CORTEX_T))'], cwd, stdin: 'hi-', env: { CORTEX_T: 'there' } });
    expect(r.stdout.trim()).toBe('hi-there');
  });

  it('stops collecting at the cap and says so', async () => {
    const MAX_OUTPUT = 1024 * 1024;
    setLimits({ ...DEFAULT_USER_CONFIG.limits, outputCapMb: 1 });
    try {
      const r = await runExec({ cmd: 'node', args: ['-e', `process.stdout.write("x".repeat(${MAX_OUTPUT} + 5000))`], cwd });
      expect(r.stdout.length).toBe(MAX_OUTPUT);
      expect(r.truncated).toBe(true);
      expect(r.code).toBe(0);
    } finally {
      setLimits(DEFAULT_USER_CONFIG.limits);
    }
  }, 30_000);

  it('reports a missing command as CliMissingError', async () => {
    await expect(runExec({ cmd: 'definitely-not-a-cortex-command', args: [], cwd })).rejects.toBeInstanceOf(CliMissingError);
  });

  it('kills on timeout', async () => {
    const r = await runExec({ cmd: 'node', args: ['-e', 'setTimeout(()=>{}, 60000)'], cwd, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.code).toBeNull();
  }, 15_000);
});

describe('globToRegExp', () => {
  it('matches *, ** and alternatives', () => {
    expect(globToRegExp('*.md', false).test('plan.md')).toBe(true);
    expect(globToRegExp('*.md', false).test('a/plan.md')).toBe(false);
    expect(globToRegExp('**/*.md', false).test('a/b/plan.md')).toBe(true);
    expect(globToRegExp('**/*.md', false).test('plan.md')).toBe(true);
    expect(globToRegExp('records/*/{plan,grill}.md', false).test('records/ABC-1/grill.md')).toBe(true);
    expect(globToRegExp('records/*/{plan,grill}.md', false).test('records/ABC-1/other.md')).toBe(false);
  });
});
