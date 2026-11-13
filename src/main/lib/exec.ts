/**
 * One-shot command execution for `exec:run`.
 *
 * We spawn via `cross-spawn` and never through a shell, so arguments can't inject shell
 * syntax. Why cross-spawn (and not execa): on Windows `gh`, `claude`, `npm` etc. are often
 * `.cmd` shims that plain `child_process.spawn` can't start without `shell: true`.
 * cross-spawn resolves the command with PATHEXT and, for `.cmd`/`.bat`, runs it via
 * `cmd.exe /d /s /c` with every argument escaped for cmd's metacharacters. It is tiny, CJS,
 * and is what execa itself uses underneath, without execa's larger ESM-only surface.
 */
import spawn from 'cross-spawn';
import type { ExecRequest, ExecResult } from '../../shared/ipc';
import { killTree, treeSpawnOptions } from './killTree';

const DEFAULT_TIMEOUT = 120_000;
/** keep at most this many chars per stream */
const MAX_OUTPUT = 20 * 1024 * 1024;

export function runExec(req: ExecRequest): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(req.cmd, req.args, {
      cwd: req.cwd,
      env: { ...process.env, ...req.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...treeSpawnOptions,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (cur: string, chunk: string) => (cur.length >= MAX_OUTPUT ? cur : (cur + chunk).slice(0, MAX_OUTPUT));
    child.stdout?.setEncoding('utf8').on('data', (c: string) => (stdout = cap(stdout, c)));
    child.stderr?.setEncoding('utf8').on('data', (c: string) => (stderr = cap(stderr, c)));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, req.timeoutMs ?? DEFAULT_TIMEOUT);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run ${req.cmd}: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr, timedOut });
    });

    child.stdin?.on('error', () => {}); // EPIPE when the child exits before reading
    child.stdin?.end(req.stdin ?? undefined);
  });
}
