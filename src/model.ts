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
}

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
