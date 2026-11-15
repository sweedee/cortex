/**
 * Workspace file migrations. `migrate(raw)` lifts any known older file to the current
 * `WORKSPACE_VERSION`, one step at a time; `parseWorkspace` then validates it with zod.
 *
 * Adding a version: bump `WORKSPACE_VERSION` in `schemas.ts`, add `MIGRATIONS[n]` that turns
 * a version-n file into a version-(n+1) file, add a fixture + test. Never edit an old step.
 */
import { z } from 'zod';
import { DEFAULT_SIDEBAR_WIDTH, ItemSchema, KindSchema, LinkSchema, PrefsSchema, WORKSPACE_VERSION, WorkspaceFileSchema } from './schemas';
import type { Item, Link, Prefs, Tone, Workspace } from './types';
import { DEFAULT_USER_CONFIG, RendererConfigPatchSchema, type UserConfigPatch } from '../../../shared/userConfig';

export const DEFAULT_PREFS: Prefs = { colorBy: 'project', sidebarWidth: DEFAULT_SIDEBAR_WIDTH };

type Raw = Record<string, unknown>;
type Step = (file: Raw, log: string[]) => Raw;

// ---- v0 → v1 -------------------------------------------------------------------------------
// v0 (phase 0a): display-only items `{id, kind, handle, short?, title, subtitle?, status: Segment[],
// notice?: {text, tone, ago, read?}, facts?: [k, v][], flags?, cluster?, archived?}`; prefs in
// localStorage. v1: typed `data` per kind, `plan` became `record`, prefs in the file.

interface V0Item {
  id: string;
  kind: string;
  handle: string;
  short?: string;
  title: string;
  subtitle?: string;
  status?: { tone: Tone; label: string; weight?: number }[];
  notice?: { text: string; tone: Tone; ago?: number; read?: boolean };
  facts?: [string, string][];
  flags?: { mergeable?: boolean; waitingForInput?: boolean; running?: boolean; approved?: boolean };
  cluster?: string;
  archived?: boolean;
}

const V0ItemSchema = z.looseObject({ id: z.string(), kind: z.string(), handle: z.string(), title: z.string() });

const int = (s: string | undefined) => {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
};
const pairOf = (s: string | undefined) => {
  const m = s?.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? ([Number(m[1]), Number(m[2])] as [number, number]) : undefined;
};
const durationSec = (s: string | undefined) => {
  const m = s?.match(/(?:(\d+)m)?\s*(?:(\d+)s)?/);
  return m && (m[1] || m[2]) ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : undefined;
};

function migrateItemV0(o: V0Item, repoOf: (cluster?: string) => string | undefined, now: number): Item | null {
  const fact = (k: string) => o.facts?.find(([key]) => key.toLowerCase() === k.toLowerCase())?.[1];
  const tone = o.status?.[0]?.tone;
  const labels = (o.status ?? []).map((s) => s.label).join(' · ');
  const repo = repoOf(o.cluster) ?? 'unknown/unknown';
  const base = {
    id: o.id,
    handle: o.handle,
    title: o.title,
    projectId: o.cluster,
    archived: o.archived || undefined,
    notice: o.notice ? { text: o.notice.text, tone: o.notice.tone, at: now - (o.notice.ago ?? 0) * 60_000, read: o.notice.read } : undefined,
    createdAt: now,
    updatedAt: now,
  };

  switch (o.kind) {
    case 'project': {
      const repoName = /^[\w.-]+\/[\w.-]+$/.test(o.subtitle ?? '') ? o.subtitle! : `unknown/${o.title.replace(/[^\w.-]/g, '-')}`;
      return {
        ...base,
        projectId: undefined,
        kind: 'project',
        data: {
          repo: repoName,
          defaultBranch: fact('Default branch') ?? 'main',
          stats: {
            mainChecks: tone === 'critical' ? 'failure' : tone === 'running' ? 'pending' : tone === 'success' ? 'success' : undefined,
            openPrs: int(fact('Open PRs')),
            renovatePrs: int(o.status?.find((s) => /renovate/i.test(s.label))?.label),
          },
        },
      };
    }
    case 'ticket': {
      // subtitle: "Story · High · In Progress"
      const [type, priority, status] = (o.subtitle ?? '').split('·').map((s) => s.trim());
      const st = status || o.status?.[0]?.label.replace(/^.*·\s*/, '') || 'To Do';
      const assignee = fact('Assignee');
      return {
        ...base,
        kind: 'ticket',
        data: {
          key: o.handle,
          status: st,
          statusCategory: /done|closed|resolved/i.test(st) ? 'done' : /to ?do|open|backlog/i.test(st) ? 'new' : 'indeterminate',
          type: type || 'Story',
          priority: priority || undefined,
          assignee: assignee && assignee !== 'unassigned' ? assignee : undefined,
          sprint: fact('Sprint'),
          points: int(fact('Points')),
        },
      };
    }
    case 'worktree': {
      const ab = pairOf(fact('Ahead / behind'));
      const dirty = int(fact('Dirty files'));
      return {
        ...base,
        kind: 'worktree',
        data: {
          path: o.subtitle ?? '',
          branch: o.title,
          baseBranch: fact('Base') ?? 'main',
          ticketKey: o.title.match(/[A-Z][A-Z0-9]+-\d+/)?.[0],
          git: ab || dirty != null ? { ahead: ab?.[0] ?? 0, behind: ab?.[1] ?? 0, dirty: (dirty ?? 0) > 0, changedFiles: dirty ?? 0 } : undefined,
        },
      };
    }
    case 'agent': {
      const f = o.flags ?? {};
      const status = f.waitingForInput ? 'waiting' : f.running || tone === 'running' ? 'running' : tone === 'critical' ? 'failed' : tone === 'success' ? 'done' : 'idle';
      const q = o.notice?.text.match(/"(.+)"/)?.[1];
      return {
        ...base,
        kind: 'agent',
        data: {
          cwd: '',
          model: o.subtitle?.split('·')[0]?.trim() || undefined,
          status,
          lastActivity: o.status?.[0]?.label.replace(/^(Running|Done)\s*·\s*/, '') || undefined,
          pendingQuestion: status === 'waiting' && q ? { toolUseId: `migrated-${o.id}`, questions: [{ question: q, options: [] }] } : undefined,
          usage: { contextPct: int(fact('Context')), costUsd: Number(fact('Cost')?.replace(/[^\d.]/g, '')) || undefined, turns: int(fact('Turns')) },
        },
      };
    }
    case 'pr': {
      const number = int(o.short ?? o.handle);
      if (!number) return null;
      const sub = o.subtitle ?? '';
      const checks = fact('Checks') ?? '';
      const reviews = pairOf(fact('Reviews'));
      const diff = fact('Diff')?.match(/\+(\d+)\s*[−-](\d+)/);
      const conflicting = (o.status ?? []).some((s) => /conflict/i.test(s.label));
      return {
        ...base,
        kind: 'pr',
        data: {
          repo,
          number,
          headBranch: '',
          baseBranch: sub.match(/→\s*(\S+)/)?.[1] ?? 'main',
          state: /merged/i.test(labels + sub) ? 'merged' : 'open',
          isDraft: /draft/i.test(sub) || tone === 'neutral',
          author: sub.match(/·\s*(\S+\[bot\])/)?.[1],
          reviewDecision: o.flags?.approved ? 'APPROVED' : /pending/i.test(labels) ? 'REVIEW_REQUIRED' : undefined,
          reviews: reviews ? { approved: reviews[0], requested: reviews[1] } : undefined,
          mergeable: conflicting ? 'CONFLICTING' : o.flags?.mergeable ? 'MERGEABLE' : 'UNKNOWN',
          checks: /fail/i.test(checks) ? { state: 'failure', failed: int(checks) ?? 1 } : /running|pending/i.test(checks) ? { state: 'pending' } : /pass/i.test(checks) ? { state: 'success' } : undefined,
          additions: diff ? Number(diff[1]) : undefined,
          deletions: diff ? Number(diff[2]) : undefined,
        },
      };
    }
    case 'build': {
      // title "console-ui #1838", subtitle "fix/CTX-4790-tile-flicker · failed in e2e"
      const branch = o.subtitle?.split('·')[0]?.trim() ?? '';
      const name = o.title.replace(/\s*#\d+$/, '');
      const running = !!o.flags?.running || tone === 'running';
      const stage = fact('Stage');
      return {
        ...base,
        kind: 'build',
        data: {
          repo: repo === 'unknown/unknown' ? `unknown/${name}` : repo,
          name,
          url: '',
          number: int(o.title.match(/#(\d+)/)?.[1]),
          state: running ? 'in_progress' : 'completed',
          conclusion: running ? undefined : tone === 'critical' ? 'failure' : 'success',
          branch,
          stage: stage && stage !== 'done' ? stage : undefined,
          trigger: fact('Trigger'),
          durationSec: durationSec(fact('Duration')),
        },
      };
    }
    case 'plan': {
      const steps = pairOf(fact('Steps'));
      const approved = fact('Approved') === 'yes';
      return {
        ...base,
        kind: 'record',
        data: {
          recordType: 'plan',
          path: `records/${o.handle}`,
          ticketKey: o.handle.match(/[A-Z][A-Z0-9]+-\d+/)?.[0],
          status: approved ? 'approved' : 'draft',
          steps: steps ? { done: steps[0], total: steps[1] } : int(fact('Steps')?.split('/')[1]) ? { done: 0, total: int(fact('Steps')?.split('/')[1])! } : undefined,
          author: fact('Author'),
        },
      };
    }
    default:
      return null;
  }
}

const v0ToV1: Step = (file, log) => {
  const now = Date.now();
  const rawItems = Array.isArray(file.items) ? file.items : [];
  const parsed = rawItems.map((r) => V0ItemSchema.safeParse(r)).flatMap((r) => (r.success ? [r.data as unknown as V0Item] : []));
  const repos = new Map(parsed.filter((i) => i.kind === 'project').map((p) => [p.id, p.subtitle]));
  const items: Item[] = [];
  for (const o of parsed) {
    const it = migrateItemV0(o, (c) => (c ? repos.get(c) : undefined), now);
    const ok = it && ItemSchema.safeParse(it);
    if (ok && ok.success) items.push(ok.data);
    else log.push(`dropped v0 item ${o.id} (${o.kind})${ok && !ok.success ? ': ' + z.prettifyError(ok.error) : ''}`);
  }
  if (parsed.length < rawItems.length) log.push(`dropped ${rawItems.length - parsed.length} malformed v0 item(s)`);
  const prefs = readLegacyPrefs();
  return { version: 1, items, links: Array.isArray(file.links) ? file.links : [], prefs };
};

/** Phase-0a prefs lived in localStorage; carry them over once. */
function readLegacyPrefs(): Raw {
  try {
    if (typeof localStorage === 'undefined') return {};
    const n = localStorage.getItem('cortex.desktopNotify');
    const s = localStorage.getItem('cortex.soundOn');
    return { ...(n != null && { desktopNotify: n === '1' }), ...(s != null && { soundOn: s !== '0' }) };
  } catch {
    return {};
  }
}

// ---- v1 → v2 -------------------------------------------------------------------------------
// v2 (phase 2b): prefs gain `model?`, `permissionMode`, `aiReviewComment?`, `refreshSec`, `sidebarWidth`;
// agent data gains `localId?`, `pendingPermissions?`, `error?` (all optional: items stay as they are).

const V2_PREF_DEFAULTS = { permissionMode: 'default', refreshSec: 60, sidebarWidth: 360 };

function v1ToV2(file: Raw): Raw {
  const prefs = file.prefs && typeof file.prefs === 'object' ? (file.prefs as Raw) : {};
  return { ...file, version: 2, prefs: { ...V2_PREF_DEFAULTS, ...prefs } };
}

// ---- v2 → v3 -------------------------------------------------------------------------------
// v3: the filter selects the kinds to SHOW (`kinds`, empty = all) instead of listing hidden ones
// (`hiddenKinds`). "hid build" becomes "show every kind except build".

function v2ToV3(file: Raw): Raw {
  const prefs = file.prefs && typeof file.prefs === 'object' ? (file.prefs as Raw) : {};
  const filter = prefs.filter && typeof prefs.filter === 'object' ? { ...(prefs.filter as Raw) } : null;
  if (!filter) return { ...file, version: 3 };
  const hidden = Array.isArray(filter.hiddenKinds) ? (filter.hiddenKinds as unknown[]) : [];
  delete filter.hiddenKinds;
  if (!Array.isArray(filter.kinds)) filter.kinds = hidden.length ? KindSchema.options.filter((k) => !hidden.includes(k)) : [];
  // every kind selected = no restriction (and "show nothing" is not a thing)
  if ((filter.kinds as unknown[]).length >= KindSchema.options.length) filter.kinds = [];
  return { ...file, version: 3, prefs: { ...prefs, filter } };
}

// ---- v3 → v4 -------------------------------------------------------------------------------
// v4: the machine / user settings leave the workspace for `~/.cortex/config.json`. The step moves
// them to `userPrefs` (not part of the file schema); `parseWorkspace` turns that into a config patch
// (`ParseResult.movedPrefs`) that the renderer hands to main once (`config:update` with `ifUnset`).

/** v3 pref → config.json key */
const MOVED_PREFS = ['desktopNotify', 'soundOn', 'model', 'effort', 'permissionMode', 'aiReviewComment', 'refreshSec'] as const;

function v3ToV4(file: Raw): Raw {
  const prefs = file.prefs && typeof file.prefs === 'object' ? { ...(file.prefs as Raw) } : {};
  const userPrefs: Raw = {};
  for (const k of MOVED_PREFS) {
    if (k in prefs) userPrefs[k] = prefs[k];
    delete prefs[k];
  }
  return { ...file, version: 4, prefs, ...(Object.keys(userPrefs).length ? { userPrefs } : {}) };
}

/**
 * The moved v3 prefs → a config.json patch. Invalid values and values equal to the default are left
 * out (so the defaults are not frozen into the file); `undefined` when nothing is left.
 */
export function movedPrefsPatch(raw: unknown): UserConfigPatch | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Raw;
  const d = DEFAULT_USER_CONFIG;
  const pick = <T>(v: unknown, ok: (x: unknown) => x is T, def: T): T | undefined => (ok(v) && v !== def ? v : undefined);
  const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
  const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
  const isNum = (x: unknown): x is number => typeof x === 'number';
  const draft = {
    claude: { model: pick(p.model, isStr, d.claude.model ?? ''), effort: pick(p.effort, isStr, d.claude.effort ?? ''), permissionMode: pick(p.permissionMode, isStr, d.claude.permissionMode) },
    github: { aiReviewComment: pick(p.aiReviewComment, isStr, d.github.aiReviewComment) },
    refresh: { intervalSec: pick(p.refreshSec, isNum, d.refresh.intervalSec) },
    ui: { notifications: pick(p.desktopNotify, isBool, d.ui.notifications), sound: pick(p.soundOn, isBool, d.ui.sound) },
  };
  // validate key by key: one bad value doesn't lose the others
  const out: Record<string, Record<string, unknown>> = {};
  for (const [section, values] of Object.entries(draft)) {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue;
      if (!RendererConfigPatchSchema.safeParse({ [section]: { [k]: v } }).success) continue;
      (out[section] ??= {})[k] = v;
    }
  }
  return Object.keys(out).length ? (out as UserConfigPatch) : undefined;
}

/** `MIGRATIONS[n]` turns a version-n file into a version-(n+1) file. */
export const MIGRATIONS: Record<number, Step> = { 0: v0ToV1, 1: v1ToV2, 2: v2ToV3, 3: v3ToV4 };

/** Lift a raw file to the current version. Throws on files from the future or of no known shape. */
export function migrate(raw: unknown, log: string[] = []): Raw {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('workspace file is not an object');
  let file = raw as Raw;
  let v = typeof file.version === 'number' ? file.version : 0;
  if (v > WORKSPACE_VERSION) throw new Error(`workspace file version ${v} is newer than this app (${WORKSPACE_VERSION})`);
  while (v < WORKSPACE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration from workspace version ${v}`);
    file = step(file, log);
    log.push(`migrated workspace v${v} → v${v + 1}`);
    v++;
  }
  return file;
}

export type ParseResult =
  | {
      ok: true;
      workspace: Workspace;
      warnings: string[];
      migrated: boolean;
      /** settings that moved out of the workspace (v3 → v4), for config.json */
      movedPrefs?: UserConfigPatch;
    }
  | { ok: false; error: string };

/**
 * Raw JSON → a valid workspace (migrated if needed). Single invalid items or links are
 * dropped with a warning; a file that is not a workspace at all is an error.
 */
export function parseWorkspace(raw: unknown): ParseResult {
  const warnings: string[] = [];
  let file: Raw;
  try {
    file = migrate(raw, warnings);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const migrated = warnings.some((w) => w.startsWith('migrated'));
  const top = WorkspaceFileSchema.safeParse(file);
  if (!top.success) return { ok: false, error: z.prettifyError(top.error) };

  const items: Item[] = [];
  const seen = new Set<string>();
  for (const r of top.data.items) {
    const p = ItemSchema.safeParse(r);
    const id = (r as { id?: unknown } | null)?.id;
    if (!p.success) warnings.push(`dropped invalid item ${String(id)}: ${z.prettifyError(p.error)}`);
    else if (seen.has(p.data.id)) warnings.push(`dropped duplicate item ${p.data.id}`);
    else (seen.add(p.data.id), items.push(p.data));
  }
  const links: Link[] = [];
  for (const r of top.data.links) {
    const p = LinkSchema.safeParse(r);
    if (!p.success) warnings.push('dropped invalid link');
    else if (!seen.has(p.data.from) || !seen.has(p.data.to)) warnings.push(`dropped dangling link ${p.data.id}`);
    else links.push(p.data);
  }
  const prefs = PrefsSchema.safeParse({ ...DEFAULT_PREFS, ...top.data.prefs });
  if (!prefs.success) warnings.push('reset invalid prefs');
  const movedPrefs = movedPrefsPatch(file.userPrefs);
  return {
    ok: true,
    migrated,
    warnings,
    ...(movedPrefs ? { movedPrefs } : {}),
    workspace: { version: WORKSPACE_VERSION, items, links, prefs: prefs.success ? prefs.data : DEFAULT_PREFS, camera: top.data.camera },
  };
}
