/**
 * Directory watches for `fs:watch` (e.g. `records/<ticket-branch>/*.md`).
 *
 * Node's built-in `fs.watch(dir, { recursive: true })` instead of chokidar: recursive mode is
 * native on Windows and macOS and supported on Linux since Node 20, our trees are small, and
 * it saves a dependency (chokidar 6 is only weeks old). The raw events are noisy (several per
 * save), so they are coalesced per path for a short moment before being emitted.
 */
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { log } from './log';
import type { FsChangedEvent } from '../../shared/ipc';

const COALESCE_MS = 60;

export class Watchers {
  private watchers = new Map<string, FSWatcher>();
  /** watchId → the client that made it */
  private owners = new Map<string, string>();
  private seq = 0;

  private emit: (e: FsChangedEvent) => void;
  constructor(emit: (e: FsChangedEvent) => void) {
    this.emit = emit;
  }

  watch(dir: string, owner?: string): string {
    const watchId = `w${++this.seq}`;
    const timers = new Map<string, { t: ReturnType<typeof setTimeout>; event: 'rename' | 'change' }>();
    const w = watch(dir, { recursive: true, persistent: false }, (event, filename) => {
      const path = filename ? join(dir, filename.toString()) : null;
      const key = path ?? '';
      const prev = timers.get(key);
      if (prev) clearTimeout(prev.t);
      // a rename (create/delete) wins over a change on the same path
      const ev = prev?.event === 'rename' ? 'rename' : (event as 'rename' | 'change');
      timers.set(key, {
        event: ev,
        t: setTimeout(() => {
          timers.delete(key);
          this.emit({ watchId, dir, event: ev, path });
        }, COALESCE_MS),
      });
    });
    w.on('error', (err) => {
      log.warn(`[fs:watch] ${dir}: ${err.message}`);
      this.unwatch(watchId);
    });
    this.watchers.set(watchId, w);
    if (owner !== undefined) this.owners.set(watchId, owner);
    return watchId;
  }

  unwatch(watchId: string): void {
    this.watchers.get(watchId)?.close();
    this.watchers.delete(watchId);
    this.owners.delete(watchId);
  }

  /** close every watch `owner` made */
  closeOwner(owner: string): void {
    for (const [id, o] of this.owners) if (o === owner) this.unwatch(id);
  }

  get size(): number {
    return this.watchers.size;
  }

  closeAll(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    this.owners.clear();
  }
}
