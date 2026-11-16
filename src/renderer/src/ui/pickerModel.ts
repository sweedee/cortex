/** Pure logic of the folder / file picker modal (`picker.tsx`). */
import type { DirEntry, FileFilter } from '../../../shared/ipc';

/** Does `name` pass the filters? No filters (or an empty / `*` list) accept everything. */
export function matchesFilters(name: string, filters?: FileFilter[]): boolean {
  const exts = (filters ?? []).flatMap((f) => f.extensions).map((e) => e.replace(/^\*?\./, '').toLowerCase());
  if (!exts.length || exts.includes('*')) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && exts.includes(name.slice(dot + 1).toLowerCase());
}

/** What the list shows: folders always; files only when picking a file (and passing the filters), others stay out. */
export function visibleEntries(entries: DirEntry[], kind: 'dir' | 'file', filters?: FileFilter[]): DirEntry[] {
  return entries.filter((e) => e.dir || (kind === 'file' && matchesFilters(e.name, filters)));
}

/** `dir` + `name` with the separator `dir` uses (the server's platform, not the browser's). */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export interface Crumb {
  label: string;
  path: string;
}

/** Breadcrumb trail for an absolute path: `/a/b` → `/`, `a`, `b`; `C:\a` → `C:\`, `a`. */
export function crumbs(path: string): Crumb[] {
  const win = path.includes('\\') && !path.includes('/');
  const sep = win ? '\\' : '/';
  const parts = path.split(sep).filter(Boolean);
  const root = win ? `${parts.shift() ?? ''}${sep}` : sep;
  const out: Crumb[] = [{ label: root, path: root }];
  let acc = root;
  for (const p of parts) {
    acc = joinPath(acc, p);
    out.push({ label: p, path: acc });
  }
  return out;
}
