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
import { execTimeoutMs, outputCap } from './limits';

/** The command could not be started (not installed / not on PATH). */
export class CliMissingError extends Error {
  readonly cmd: string;
  constructor(cmd: string, reason: string) {
    super(`Could not run ${cmd}: ${reason}`);
    this.name = 'CliMissingError';
    this.cmd = cmd;
  }
}

/** Collects a stream's chunks up to `outputCap()` chars (config `limits.outputCapMb`; the result says `truncated` when more came) (no repeated string concatenation / re-slicing). */
class Collector {
  private chunks: string[] = [];
  private size = 0;
  truncated = false;
  push(chunk: string): void {
    const cap = outputCap();
    if (this.size >= cap) {
      this.truncated = true;
      return;
    }
    const room = cap - this.size;
    if (chunk.length > room) {
      this.chunks.push(chunk.slice(0, room));
      this.size = cap;
      this.truncated = true;
    } else {
      this.chunks.push(chunk);
      this.size += chunk.length;
    }
  }
  text(): string {
    return this.chunks.join('');
  }
}

/** What `runExec` takes: an `exec:run` request, or (main-internal) any resolved command. */
export type ExecSpawn = Omit<ExecRequest, 'cmd'> & { cmd: string };

export function runExec(req: ExecSpawn): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(req.cmd, req.args, {
      cwd: req.cwd,
      env: { ...process.env, ...req.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...treeSpawnOptions,
    });
    const stdout = new Collector();
    const stderr = new Collector();
    let timedOut = false;
    child.stdout?.setEncoding('utf8').on('data', (c: string) => stdout.push(c));
    child.stderr?.setEncoding('utf8').on('data', (c: string) => stderr.push(c));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, req.timeoutMs ?? execTimeoutMs());

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CliMissingError(req.cmd, err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout: stdout.text(), stderr: stderr.text(), timedOut, truncated: stdout.truncated || stderr.truncated });
    });

    child.stdin?.on('error', () => {}); // EPIPE when the child exits before reading
    child.stdin?.end(req.stdin ?? undefined);
  });
}
