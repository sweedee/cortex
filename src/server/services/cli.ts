/**
 * Shared plumbing for the integration services: a `Runner` (injectable for tests) that runs a
 * command shell-less via `runExec`, and `CliError` carrying exit code and stderr.
 */
import type { z } from 'zod';
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
  readonly timedOut: boolean;
  /** `label` replaces the "<cmd> <subcommand>" prefix of the message (e.g. "jira transition" for the mock run through node) */
  constructor(cmd: string, args: string[], r: ExecResult, label?: string) {
    const detail = (r.stderr || r.stdout).trim().replace(/^(✗\s*)?(Error|Failure): /i, '') || (r.timedOut ? 'timed out' : `exit code ${r.code}`);
    // "gh pr create: …", "git worktree remove: …" (the subcommand, not its options / values)
    const sub = args.slice(0, args.findIndex((a) => a.startsWith('-')) >>> 0).slice(0, 3);
    super(`${label ?? [cmd, ...sub].join(' ')}: ${detail}`);
    this.name = 'CliError';
    this.cmd = cmd;
    this.args = args;
    this.code = r.code;
    this.stderr = r.stderr;
    this.stdout = r.stdout;
    this.timedOut = r.timedOut;
  }
}

/** Run and throw `CliError` on a non-zero exit; resolves stdout. */
export async function runOk(run: Runner, cmd: string, args: string[], opts: RunOptions, label?: string): Promise<string> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new CliError(cmd, args, r, label);
  return r.stdout;
}

/** A CLI printed JSON that is not what we consume (or no JSON at all). */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Parse CLI output as JSON and check it against `schema`. The schemas (see `schemas.ts`) only pin the
 * fields the app relies on and let everything else through, so additions in the tools' output are harmless.
 */
export function parseJson<T>(text: string, what: string, schema?: z.ZodType<unknown>): T {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new ParseError(`${what}: expected JSON, got: ${text.slice(0, 200)}`);
  }
  if (schema) {
    const r = schema.safeParse(v);
    if (!r.success)
      throw new ParseError(
        `${what}: unexpected output (${r.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')})`,
      );
  }
  return v as T;
}
