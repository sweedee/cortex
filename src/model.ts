/**
 * Cortex canvas model. Everything on the canvas is an Item (a bubble); Links connect them.
 * The UI derives all visuals (ring, icon, actions) from these plain objects.
 */

export type Kind = 'project' | 'ticket' | 'worktree' | 'agent' | 'pr' | 'build' | 'plan';

/** Colour family of a status ring segment / notice. `running` animates. */
export type Tone = 'success' | 'warning' | 'critical' | 'running' | 'primary' | 'neutral' | 'pending';

/** One slice of the status ring. Weights are relative (default 1). */
export interface Segment {
  tone: Tone;
  label: string;
  weight?: number;
}

export interface Notice {
  text: string;
  tone: Tone;
  /** minutes ago (prototype only, avoids date math) */
  ago: number;
  /** seen in the notifications menu or by selecting the bubble; the badge goes away */
  read?: boolean;
}

export interface Item {
  id: string;
  kind: Kind;
  /** what you type after @ in the chat box */
  handle: string;
  /** short text inside the bubble (key, #number, …); falls back to the icon only */
  short?: string;
  title: string;
  /** secondary line in the hover card */
  subtitle?: string;
  status: Segment[];
  notice?: Notice;
  /** key facts for the hover card */
  facts?: [string, string][];
  /** kind specific flags that steer actions */
  flags?: {
    mergeable?: boolean;
    waitingForInput?: boolean;
    running?: boolean;
    approved?: boolean;
  };
  /** the project cluster this item gravitates towards */
  cluster?: string;
  /** completed or put away: hidden unless the filter shows archived items */
  archived?: boolean;
}

export const KINDS: Kind[] = ['project', 'ticket', 'worktree', 'agent', 'pr', 'build', 'plan'];

export interface Link {
  id: string;
  from: string;
  to: string;
  label: string;
}

export const KIND_LABEL: Record<Kind, string> = {
  project: 'Project',
  ticket: 'Ticket',
  worktree: 'Worktree',
  agent: 'Agent session',
  pr: 'Pull request',
  build: 'CI build',
  plan: 'Plan file',
};

/** Bubble radius in world pixels. */
export const KIND_RADIUS: Record<Kind, number> = {
  project: 54,
  ticket: 38,
  worktree: 32,
  agent: 34,
  pr: 36,
  build: 26,
  plan: 28,
};

/** Position in the hierarchy: projects at the top, builds at the bottom. */
export const KIND_LEVEL: Record<Kind, number> = { project: 0, ticket: 1, plan: 2, worktree: 2, agent: 3, pr: 3, build: 4 };

/** Status buckets for filtering, derived from the ring tones (and the waiting flag). */
export type StatusGroup = 'attention' | 'failing' | 'running' | 'active' | 'review' | 'done' | 'idle';

export const STATUS_GROUPS: { id: StatusGroup; label: string; tone: Tone; test: (i: Item) => boolean }[] = [
  { id: 'attention', label: 'Needs attention', tone: 'warning', test: (i) => !!i.flags?.waitingForInput || i.status.some((s) => s.tone === 'warning') },
  { id: 'failing', label: 'Failing / blocked', tone: 'critical', test: (i) => i.status.some((s) => s.tone === 'critical') },
  { id: 'running', label: 'Running', tone: 'running', test: (i) => !!i.flags?.running || i.status.some((s) => s.tone === 'running') },
  { id: 'active', label: 'In progress', tone: 'primary', test: (i) => i.status.some((s) => s.tone === 'primary') },
  { id: 'review', label: 'Pending / review', tone: 'pending', test: (i) => i.status.some((s) => s.tone === 'pending') },
  { id: 'done', label: 'Green / done', tone: 'success', test: (i) => i.status.some((s) => s.tone === 'success') },
  { id: 'idle', label: 'Idle / to do', tone: 'neutral', test: (i) => i.status.some((s) => s.tone === 'neutral') },
];

/**
 * For every item, the roots of the given kind it rolls up to: walk links "upwards"
 * (towards lower levels) and stop at the first item of that kind on each path.
 */
export function rootsOf(items: Item[], links: Link[], kind: Kind): Map<string, string[]> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const up = new Map<string, string[]>();
  for (const l of links) {
    const a = byId.get(l.from),
      b = byId.get(l.to);
    if (!a || !b || KIND_LEVEL[a.kind] === KIND_LEVEL[b.kind]) continue;
    const [lo, hi] = KIND_LEVEL[a.kind] > KIND_LEVEL[b.kind] ? [a, b] : [b, a];
    up.set(lo.id, [...(up.get(lo.id) ?? []), hi.id]);
  }
  const out = new Map<string, string[]>();
  for (const it of items) {
    const found = new Set<string>();
    const seen = new Set<string>();
    const stack = [it.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (byId.get(id)?.kind === kind) {
        found.add(id);
        continue; // stop at the root, don't climb past it
      }
      stack.push(...(up.get(id) ?? []));
    }
    if (found.size) out.set(it.id, [...found]);
  }
  return out;
}
