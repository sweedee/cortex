/**
 * Server logger: a size-rotated file under `<userData>/logs` plus the console (the console may be
 * gone, e.g. a server started in the background). Synchronous appends so a crash handler can still
 * write. No dependencies.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export class RotatingLog {
  private size: number;
  readonly file: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  constructor(file: string, maxBytes = 512 * 1024, keep = 3) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep;
    mkdirSync(join(file, '..'), { recursive: true });
    try {
      this.size = statSync(file).size;
    } catch {
      this.size = 0;
    }
  }

  /** `<base>.1<ext>` is the newest rotated file, `.N` the oldest. */
  rotated(i: number) {
    const dot = this.file.lastIndexOf('.');
    return dot > 0 ? `${this.file.slice(0, dot)}.${i}${this.file.slice(dot)}` : `${this.file}.${i}`;
  }

  write(line: string) {
    const text = line.endsWith('\n') ? line : `${line}\n`;
    try {
      if (this.size > 0 && this.size + Buffer.byteLength(text) > this.maxBytes) this.rotate();
      appendFileSync(this.file, text);
      this.size += Buffer.byteLength(text);
    } catch {
      /* logging must never throw */
    }
  }

  private rotate() {
    rmSync(this.rotated(this.keep), { force: true });
    for (let i = this.keep - 1; i >= 1; i--) if (existsSync(this.rotated(i))) renameSync(this.rotated(i), this.rotated(i + 1));
    renameSync(this.file, this.rotated(1));
    this.size = 0;
  }
}

let sink: RotatingLog | null = null;

/** Start writing to `<dir>/main.log`; before this, messages only go to the console. */
export function initLog(dir: string, maxBytes?: number, keep?: number) {
  try {
    sink = new RotatingLog(join(dir, 'main.log'), maxBytes, keep);
  } catch (e) {
    console.warn('[log] file logging unavailable', e);
  }
}

export function formatArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

function emit(level: LogLevel, args: unknown[]) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(...args);
  sink?.write(`${new Date().toISOString()} ${level.toUpperCase()} ${args.map(formatArg).join(' ')}`);
}

export const log = {
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};

/** Log otherwise-fatal errors instead of losing them (the server keeps running). */
export function installCrashHandlers() {
  process.on('uncaughtException', (err) => log.error('[main] uncaughtException', err));
  process.on('unhandledRejection', (reason) => log.error('[main] unhandledRejection', reason));
}
