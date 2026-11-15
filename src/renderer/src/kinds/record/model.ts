/**
 * Pure helpers of the record kind: file name → type, step counting, and the discovery plan
 * (which record items to add / update for the files found under `<baseDir>/records`). Unit-tested.
 */
import type { Item, ItemOf, LinkLabel, NewItem, RecordData } from '../../domain';

type RecordType = RecordData['recordType'];

/** `C:\a\b` and `c:/a/b/` compare equal (case-insensitive: Windows and macOS paths). */
export const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const isAbsolutePath = (p: string | undefined): p is string => !!p && /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(p);

export const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const RECORD_HINT = 'This record has no file on disk (demo data). Records live in <project base checkout>/records/<ticket-branch>/<name>.md; real ones are discovered automatically.';

/** `plan.md`, `PLAN-CTX-1.md`, `brainstorm_x.md`, `grill.md`, `verification.md`, `verify-…`: a prefix match. */
export function recordTypeOf(fileName: string): RecordType | undefined {
  const n = baseName(fileName).toLowerCase();
  if (!n.endsWith('.md')) return undefined;
  if (n.startsWith('plan')) return 'plan';
  if (n.startsWith('brainstorm')) return 'brainstorm';
  if (n.startsWith('grill')) return 'grill';
  if (n.startsWith('verif')) return 'verification';
  return undefined;
}

/** Checked / total task-list items (`- [x]`), ignoring fenced code. */
export function countSteps(md: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s/.exec(line);
    if (m) {
      total++;
      if (m[1] !== ' ') done++;
    }
  }
  return { done, total };
}

const TICKET_KEY = /[A-Z][A-Z0-9]+-\d+/;
export const ticketKeyOf = (s: string) => TICKET_KEY.exec(s)?.[0];

/** The branch folder of a file relative to the records dir: `feat/CTX-1-x/plan.md` → `feat/CTX-1-x`. */
export function branchFolder(relName: string): string | undefined {
  const parts = relName.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
}

/** Does a branch correspond to a records folder (exact, or with `/` flattened to `-`)? */
export const sameBranch = (branch: string | undefined, folder: string) => !!branch && (branch === folder || branch.replace(/\//g, '-') === folder);

export interface FoundRecord {
  /** absolute file path */
  path: string;
  /** path relative to the records dir, forward slashes */
  name: string;
  /** file content (for the step count) */
  text?: string;
}

export interface DiscoveryUpdate {
  id: string;
  patch: Partial<RecordData>;
}
export interface DiscoveryAdd {
  item: NewItem;
  /** items to link the new record to (label from the record type) */
  links: { to: string; label: LinkLabel }[];
}
export interface DiscoveryLink {
  from: string;
  to: string;
  label: LinkLabel;
}
export interface DiscoveryPlan {
  add: DiscoveryAdd[];
  update: DiscoveryUpdate[];
  links: DiscoveryLink[];
}

export const LINK_LABEL: Record<RecordType, LinkLabel> = { plan: 'plan for', brainstorm: 'brainstorm for', grill: 'grill for', verification: 'verification of' };

/** Tickets / worktrees of a project whose branch is the records folder. */
export function relatedTo(items: Item[], projectId: string, folder: string | undefined): { ticket?: ItemOf<'ticket'>; worktree?: ItemOf<'worktree'> } {
  if (!folder) return {};
  const mine = items.filter((i) => !i.archived && (i.projectId === projectId || i.kind === 'ticket'));
  const worktree = mine.find((i): i is ItemOf<'worktree'> => i.kind === 'worktree' && i.projectId === projectId && sameBranch(i.data.branch, folder));
  const ticket =
    mine.find((i): i is ItemOf<'ticket'> => i.kind === 'ticket' && sameBranch(i.data.branch, folder)) ??
    (() => {
      const key = ticketKeyOf(folder) ?? worktree?.data.ticketKey;
      return key ? mine.find((i): i is ItemOf<'ticket'> => i.kind === 'ticket' && i.data.key === key) : undefined;
    })();
  return { ticket, worktree };
}

/**
 * What to do for the record files found in one project. Records are keyed by path (never duplicated);
 * existing ones only get their step count / branch refreshed. Files that are no record type are skipped.
 */
export function planDiscovery(items: Item[], project: ItemOf<'project'>, found: FoundRecord[]): DiscoveryPlan {
  const plan: DiscoveryPlan = { add: [], update: [], links: [] };
  const byPath = new Map(items.filter((i): i is ItemOf<'record'> => i.kind === 'record').map((r) => [normPath(r.data.path), r]));
  const handles = new Set(items.map((i) => i.handle.toLowerCase()));
  for (const f of found) {
    const recordType = recordTypeOf(f.name);
    if (!recordType) continue;
    const folder = branchFolder(f.name);
    const steps = f.text !== undefined ? countSteps(f.text) : undefined;
    const rel = relatedTo(items, project.id, folder);
    const existing = byPath.get(normPath(f.path));
    if (existing) {
      const patch: Partial<RecordData> = {};
      if (steps && steps.total > 0 && (existing.data.steps?.done !== steps.done || existing.data.steps?.total !== steps.total)) patch.steps = steps;
      if (folder && existing.data.ticketBranch !== folder) patch.ticketBranch = folder;
      const key = rel.ticket?.data.key ?? ticketKeyOf(f.name) ?? (folder && ticketKeyOf(folder));
      if (key && existing.data.ticketKey !== key) patch.ticketKey = key;
      if (Object.keys(patch).length) plan.update.push({ id: existing.id, patch });
      for (const t of [rel.ticket, rel.worktree]) if (t) plan.links.push({ from: existing.id, to: t.id, label: LINK_LABEL[recordType] });
      continue;
    }
    const name = baseName(f.path);
    let handle = name;
    if (handles.has(handle.toLowerCase())) handle = folder ? `${folder.split('/').pop()}/${name}` : name;
    handles.add(handle.toLowerCase());
    const key = rel.ticket?.data.key ?? ticketKeyOf(name) ?? (folder ? ticketKeyOf(folder) : undefined);
    plan.add.push({
      item: {
        kind: 'record',
        handle,
        title: name,
        projectId: project.id,
        data: {
          recordType,
          path: f.path,
          ticketBranch: folder,
          ticketKey: key,
          status: recordType === 'plan' || recordType === 'brainstorm' ? 'draft' : 'approved',
          ...(steps && steps.total > 0 ? { steps } : {}),
        },
      },
      links: [rel.ticket, rel.worktree].flatMap((t) => (t ? [{ to: t.id, label: LINK_LABEL[recordType] }] : [])),
    });
  }
  return plan;
}
