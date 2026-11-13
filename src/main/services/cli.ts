/**
 * Shared plumbing for the integration services: a `Runner` (injectable for tests) that runs a
 * command shell-less via `runExec`, and `CliError` carrying exit code and stderr.
 */
import type { ExecResult } from '../../shared/ipc';
import { runExec } from '../lib/exec';

export interface RunOptions {
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export type Runner = (cmd: string, args: string[], opts: RunOptions) => Promise<ExecResult>;

export const defaultRunner: Runner = (cmd, args, opts) => runExec({ cmd, args, ...opts });

export class CliError extends Error {
  readonly cmd: string;
  readonly args: string[];
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
  constructor(cmd: string, args: string[], r: ExecResult) {
    const detail = (r.stderr || r.stdout).trim() || (r.timedOut ? 'timed out' : `exit code ${r.code}`);
    super(`${cmd} ${args.slice(0, 3).join(' ')}: ${detail}`);
    this.name = 'CliError';
    this.cmd = cmd;
    this.args = args;
    this.code = r.code;
    this.stderr = r.stderr;
    this.stdout = r.stdout;
  }
}

/** Run and throw `CliError` on a non-zero exit; resolves stdout. */
export async function runOk(run: Runner, cmd: string, args: string[], opts: RunOptions): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new CliError(cmd, args, r);
  return r.stdout;
}

export function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what}: expected JSON, got: ${text.slice(0, 200)}`);
  }
}
