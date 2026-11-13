/**
 * The workspace JSON file in userData. Main only stores JSON; the renderer owns the
 * schema (Phase 0b adds zod + versioning there).
 *
 * - writes are atomic (tmp + rename) and serialized: while one write runs, further saves
 *   only replace the pending data, so at most one write is queued and the last one wins
 * - before each write the current file is copied to `<file>.bak`
 * - load falls back to the `.bak` when the main file is missing or unreadable
 */
import { promises as fs } from 'node:fs';
import { atomicWrite } from './atomicWrite';

export class WorkspaceFile {
  private writing: Promise<void> | null = null;
  private pending: { text: string } | null = null;

  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  get backup() {
    return `${this.file}.bak`;
  }

  get busy() {
    return this.writing != null;
  }

  async load(): Promise<unknown | null> {
    for (const f of [this.file, this.backup]) {
      try {
        return JSON.parse(await fs.readFile(f, 'utf8')) as unknown;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[workspace] could not read ${f}: ${(err as Error).message}`);
      }
    }
    return null;
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
        try {
          await fs.copyFile(this.file, this.backup);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        await atomicWrite(this.file, text);
      }
    } finally {
      this.writing = null;
    }
  }
}
