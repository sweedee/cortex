/**
 * The workspace JSON file in userData. Main only stores JSON; the renderer owns the
 * schema (Phase 0b adds zod + versioning there).
 *
 * - writes are atomic (tmp + rename) and serialized: while one write runs, further saves
 *   only replace the pending data, so at most one write is queued and the last one wins
 * - before each write the current file is copied to a timestamped backup `<file>.<ts>.bak`, but
 *   only if it parses; the newest BACKUPS_KEPT are kept
 * - load tries the main file, then the backups newest first, then a legacy `<file>.bak`; a main
 *   file that exists but does not parse is renamed to `<name>.corrupt-<ts>.json` first
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { atomicWrite } from './atomicWrite';
import { log } from './log';

export const BACKUPS_KEPT = 5;
const CORRUPT_KEPT = 5;

const parses = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

export class WorkspaceFile {
  private writing: Promise<void> | null = null;
  private pending: { text: string } | null = null;

  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  /** The pre-timestamp single backup of older versions (still read on load). */
  get backup() {
    return `${this.file}.bak`;
  }

  get busy() {
    return this.writing != null;
  }

  /** Timestamped backups, newest first. */
  async backups(): Promise<string[]> {
    const base = basename(this.file);
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
    const re = new RegExp(`^${esc}\\.(\\d+)\\.bak$`);
    let names: string[] = [];
    try {
      names = await fs.readdir(dirname(this.file));
    } catch {
      /* no directory yet */
    }
    return names
      .filter((n) => re.test(n))
      .sort()
      .reverse()
      .map((n) => join(dirname(this.file), n));
  }

  async load(): Promise<unknown | null> {
    let text: string | null = null;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`[workspace] could not read ${this.file}: ${(err as Error).message}`);
    }
    if (text != null) {
      try {
        return JSON.parse(text) as unknown;
      } catch (err) {
        log.warn(`[workspace] ${this.file} is corrupt: ${(err as Error).message}`);
        await this.setAside();
      }
    }
    for (const f of [...(await this.backups()), this.backup]) {
      try {
        const data = JSON.parse(await fs.readFile(f, 'utf8')) as unknown;
        log.warn(`[workspace] restored from ${f}`);
        return data;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`[workspace] could not read ${f}: ${(err as Error).message}`);
      }
    }
    return null;
  }

  /** Rename a bad main file to `<name>.corrupt-<ts>.json` (keeping the newest few). */
  private async setAside() {
    const dir = dirname(this.file);
    const stem = basename(this.file).replace(/\.json$/, '');
    try {
      await fs.rename(this.file, join(dir, `${stem}.corrupt-${Date.now()}.json`));
      const old = (await fs.readdir(dir))
        .filter((n) => n.startsWith(`${stem}.corrupt-`))
        .sort()
        .reverse();
      for (const n of old.slice(CORRUPT_KEPT)) await fs.rm(join(dir, n), { force: true });
    } catch (err) {
      log.warn(`[workspace] could not set aside ${this.file}: ${(err as Error).message}`);
    }
  }

  /** Back the current file up (if it is valid) and prune old backups. */
  private async rotate() {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    if (!parses(text)) {
      await this.setAside(); // keep the good backups; the bad file is kept for inspection
      return;
    }
    const existing = await this.backups();
    const newest = existing[0] ? Number(/\.(\d+)\.bak$/.exec(existing[0])![1]) : 0;
    const ts = String(Math.max(Date.now(), newest + 1)).padStart(13, '0');
    await fs.writeFile(`${this.file}.${ts}.bak`, text, 'utf8');
    for (const f of [`${this.file}.${ts}.bak`, ...existing].slice(BACKUPS_KEPT)) await fs.rm(f, { force: true });
  }

  /** Queue a save; resolves once this data (or newer data) is on disk. */
  save(data: unknown): Promise<void> {
    this.pending = { text: JSON.stringify(data, null, 2) };
    if (!this.writing) this.writing = this.drain();
    return this.writing;
  }

  /** Wait for every queued write. */
  async flush(): Promise<void> {
    while (this.writing) await this.writing;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const { text } = this.pending;
        this.pending = null;
        await this.rotate();
        await atomicWrite(this.file, text);
      }
    } finally {
      this.writing = null;
    }
  }
}
