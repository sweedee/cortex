/**
 * Record discovery: for every project with a real base checkout, scan `<baseDir>/<records.dir>/**\/*.md`
 * (config.json `records.dir`, default `records`),
 * add / refresh `record` items (keyed by path, never duplicated) and keep watching the folder.
 * Started once from `sync/` via `startRecordDiscovery()` (desktop only).
 */
import type { ItemOf } from '../../domain';
import { isDesktop, native } from '../../native';
import { addItem, addLink, getState, makeItem, patchData, subscribe } from '../../store';
import { userConfig } from '../../data/config';
import { isAbsolutePath, planDiscovery, type FoundRecord } from './model';

type Project = ItemOf<'project'>;

const RESCAN_MS = 400;
/** records folder that does not exist yet: look again every so often */
const POLL_MS = 30_000;

interface Watch {
  dir: string;
  watchId?: string;
  timer?: ReturnType<typeof setTimeout>;
  poll?: ReturnType<typeof setInterval>;
  stopped?: boolean;
}

const watches = new Map<string, Watch>(); // by project id

const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
/** config.json `records.dir` as path segments (`.cortex/records` → ['.cortex', 'records']) */
const recordsSegments = (rel: string) => rel.split(/[\\/]+/).filter((s) => s && s !== '.');
/** `<baseDir>/<rel>` with the base's separator (`rel`: config.json `records.dir`, relative, no `..`). */
export const recordsDir = (baseDir: string, rel = userConfig().records.dir) => [baseDir.replace(/[\\/]+$/, ''), ...recordsSegments(rel)].join(sep(baseDir));

/** Scan one project's records folder and apply the plan to the store. Returns the number of changes. */
export async function scanProject(project: Project): Promise<number> {
  const baseDir = project.data.baseDir;
  if (!isAbsolutePath(baseDir)) return 0;
  const dir = recordsDir(baseDir);
  let entries;
  try {
    // ask the parent first: a missing folder is normal and should not log an IPC error every poll
    if (!(await hasRecordsDir(baseDir))) return 0;
    entries = await native.fs.list({ dir, options: { glob: '**/*.md' } });
  } catch {
    return 0; // no records folder (yet)
  }
  const found: FoundRecord[] = [];
  for (const e of entries) {
    if (e.isDir) continue;
    let text: string | undefined;
    try {
      text = await native.fs.readText({ path: e.path });
    } catch {
      /* unreadable: still list it */
    }
    found.push({ path: e.path, name: e.name, text });
  }
  const fresh = getState().items.find((i): i is Project => i.id === project.id && i.kind === 'project') ?? project;
  const plan = planDiscovery(getState().items, fresh, found);
  for (const a of plan.add) {
    const item = makeItem(a.item);
    addItem(
      item,
      a.links.map((l) => ({ from: item.id, to: l.to, label: l.label })),
    );
  }
  for (const u of plan.update) patchData<'record'>(u.id, u.patch);
  for (const l of plan.links) addLink(l.from, l.to, l.label);
  return plan.add.length + plan.update.length;
}

/**
 * The records folder exists: lists each parent for the next segment instead of the folder itself, so
 * a missing folder never throws ENOENT (and never logs an IPC error every poll).
 */
async function hasRecordsDir(baseDir: string, rel = userConfig().records.dir): Promise<boolean> {
  let dir = baseDir.replace(/[\\/]+$/, '');
  for (const seg of recordsSegments(rel)) {
    const entries = await native.fs.list({ dir, options: { glob: seg } }).catch(() => []);
    if (!entries.some((e) => e.isDir && e.name === seg)) return false;
    dir = `${dir}${sep(baseDir)}${seg}`;
  }
  return true;
}

async function startWatch(project: Project, w: Watch) {
  try {
    if (!(await hasRecordsDir(current(project).data.baseDir ?? ''))) throw new Error('no records folder');
    const id = await native.fs.watch({ dir: w.dir });
    if (w.stopped) {
      void native.fs.unwatch({ watchId: id });
      return;
    }
    w.watchId = id;
    if (w.poll) clearInterval(w.poll);
    w.poll = undefined;
  } catch {
    // folder missing: poll until it appears
    if (!w.poll && !w.stopped) {
      w.poll = setInterval(() => {
        void scanProject(current(project)).then(() => (w.watchId ? undefined : startWatch(current(project), w)));
      }, POLL_MS);
    }
  }
}

const current = (p: Project) => getState().items.find((i): i is Project => i.id === p.id && i.kind === 'project') ?? p;

function stopWatch(w: Watch) {
  w.stopped = true;
  if (w.timer) clearTimeout(w.timer);
  if (w.poll) clearInterval(w.poll);
  if (w.watchId) void native.fs.unwatch({ watchId: w.watchId }).catch(() => {});
}

/** Start / stop watchers so they match the projects' base directories. */
function reconcileWatches() {
  const projects = getState().items.filter((i): i is Project => i.kind === 'project' && !i.archived && isAbsolutePath(i.data.baseDir));
  const wanted = new Map(projects.map((p) => [p.id, recordsDir(p.data.baseDir!)]));
  for (const [id, w] of watches) {
    if (wanted.get(id) !== w.dir) {
      stopWatch(w);
      watches.delete(id);
    }
  }
  for (const p of projects) {
    if (watches.has(p.id)) continue;
    const w: Watch = { dir: recordsDir(p.data.baseDir!) };
    watches.set(p.id, w);
    void scanProject(p).then(() => startWatch(p, w));
  }
}

let started = false;

/** Call once after the workspace is loaded (desktop only; no-op elsewhere). */
export function startRecordDiscovery(): () => void {
  if (!isDesktop || started) return () => {};
  started = true;
  reconcileWatches();
  let sig = '';
  const unsubStore = subscribe((s) => {
    const next = s.items
      .filter((i) => i.kind === 'project')
      .map((i) => `${i.id}|${i.archived ? 1 : 0}|${(i as Project).data.baseDir ?? ''}`)
      .join(';');
    if (next !== sig) {
      sig = next;
      reconcileWatches();
    }
  });
  const unsubFs = native.fs.onChanged((e) => {
    for (const [id, w] of watches) {
      if (w.watchId !== e.watchId) continue;
      if (e.path && !/\.md$/i.test(e.path) && e.event !== 'rename') continue;
      if (w.timer) clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        const p = getState().items.find((i): i is Project => i.id === id && i.kind === 'project');
        if (p) void scanProject(p);
      }, RESCAN_MS);
    }
  });
  // config.json `records.dir` changed: watch the new folders (once data/config.ts has applied it)
  const unsubConfig = native.config.onChanged(() => setTimeout(reconcileWatches, 0));
  return () => {
    started = false;
    unsubConfig();
    unsubStore();
    unsubFs();
    for (const w of watches.values()) stopWatch(w);
    watches.clear();
  };
}
