import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FsEntry, FsListOptions } from '../../shared/ipc';
import { globToRegExp, isDeepGlob } from './glob';

/** at most this many entries per listing, so a stray `**` on a huge tree can't hang main */
const MAX_ENTRIES = 20_000;
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** List `dir`; with a glob, only matching entries (a glob with `/` or `**` walks subdirs). */
export async function listDir(dir: string, options: FsListOptions = {}): Promise<FsEntry[]> {
  const { glob } = options;
  const match = glob ? globToRegExp(glob) : null;
  const deep = !!glob && isDeepGlob(glob);
  const out: FsEntry[] = [];
  const walk = async (rel: string) => {
    const entries = await fs.readdir(join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      if (out.length >= MAX_ENTRIES) return;
      const name = rel ? `${rel}/${e.name}` : e.name;
      const isDir = e.isDirectory();
      if (!match || match.test(name)) out.push({ name, path: join(dir, name), isDir });
      if (deep && isDir && !SKIP_DIRS.has(e.name)) await walk(name);
    }
  };
  await walk('');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
