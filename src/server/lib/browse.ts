/**
 * The folder / file picker's view of the disk (`dialog:listDir`, `dialog:confirmPick`). There are no
 * native dialogs in a web app: the renderer shows its own modal and browses with these. Names only
 * (no sizes, dates or contents), hidden (dot) entries are never listed, and the locations
 * `pathPolicy.ts` always refuses (home dot-entries such as `~/.ssh`, system / autostart folders)
 * can't be listed either.
 */
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MAX_DIR_ENTRIES, type DirEntry, type DirListing } from '../../shared/ipc';
import { PathNotAllowedError, sensitiveReason, type PathEnv } from './pathPolicy';

const hidden = (name: string) => name.startsWith('.');

const notFound = (path: string, what: string) => Object.assign(new Error(`${path}: ${what}`), { code: 'ENOENT' });

export async function browseDir(path: string | undefined, env: PathEnv, max = MAX_DIR_ENTRIES): Promise<DirListing> {
  const dir = resolve(path ?? env.home);
  const refused = sensitiveReason(dir, env);
  if (refused) throw new PathNotAllowedError(`Not listed: ${dir} (${refused})`);
  let raw;
  try {
    raw = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw notFound(dir, 'no such folder');
    if (code === 'EACCES' || code === 'EPERM') throw new PathNotAllowedError(`Not listed: ${dir} (permission denied)`);
    throw e;
  }
  const visible = raw.filter((e) => !hidden(e.name));
  const entries: DirEntry[] = [];
  for (const e of visible) {
    let isDir = e.isDirectory();
    // a symlink counts as what it points at (a dangling one as a file)
    if (e.isSymbolicLink())
      isDir = await fs.stat(join(dir, e.name)).then(
        (s) => s.isDirectory(),
        () => false,
      );
    if (!isDir && !e.isFile() && !e.isSymbolicLink()) continue; // sockets, fifos, devices
    entries.push({ name: e.name, dir: isDir });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  const parent = dirname(dir) === dir ? null : dirname(dir);
  const listing: DirListing = { path: dir, parent, entries: entries.slice(0, max) };
  if (entries.length > max) listing.truncated = true;
  return listing;
}

/** The picked path, if it exists and is a `kind`; throws otherwise. */
export async function checkPick(path: string, kind: 'dir' | 'file'): Promise<string> {
  const p = resolve(path);
  const s = await fs.stat(p).catch(() => null);
  if (!s) throw notFound(p, 'does not exist');
  if (kind === 'dir' && !s.isDirectory()) throw new Error(`${p} is not a folder`);
  if (kind === 'file' && !s.isFile()) throw new Error(`${p} is not a file`);
  return p;
}
