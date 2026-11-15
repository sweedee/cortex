/**
 * The contract every kind module (`kinds/<kind>/index.tsx`) implements. The canvas, HUD,
 * sidebar and chat box only talk to kinds through this interface (via `getKind` and the
 * helpers in `registry.ts`), never through `switch (item.kind)`.
 */
import type { ComponentType, ReactElement } from 'react';
import type { Item, ItemOf, Kind, Link, LinkLabel, NewItem, Segment, Tone } from '../domain';

export type ActionKind = 'skill' | 'external' | 'direct' | 'view';

export interface Action {
  id: string;
  label: string;
  /** skill = inserts a skill into the chat box; external = opens something outside; direct = changes something; view = opens a viewer */
  type: ActionKind;
  icon: ReactElement;
  /** the skill inserted into the chat box (type 'skill') */
  skill?: string;
  /** shown first / emphasised; the first enabled primary action runs on double-click / Enter */
  primary?: boolean;
  danger?: boolean;
  /** reason it is disabled */
  disabled?: string;
  run: (items: Item[]) => void;
}

/**
 * Read access to the world around an item, for derivations and actions. Built once per
 * (items, links) change and cached, so it is cheap to use in render.
 */
export interface KindCtx {
  items: Item[];
  links: Link[];
  get(id: string): Item | undefined;
  /** typed lookup: the item if it exists and has that kind */
  getAs<K extends Kind>(id: string | undefined, kind: K): ItemOf<K> | undefined;
  /** items linked to `id` (either direction), optionally only of one kind */
  linked<K extends Kind>(id: string, kind?: K): ItemOf<K>[];
  /** items whose `projectId` is `projectId`, optionally only of one kind */
  inProject<K extends Kind>(projectId: string, kind?: K): ItemOf<K>[];
  /** the project an item belongs to (its `projectId`) */
  projectOf(item: Item): ItemOf<'project'> | undefined;
  /** the module of another kind (icons / labels of related items) */
  kind<K extends Kind>(kind: K): KindModule<K>;
}

/** Small chip on the bubble (e.g. a deployment's stage). */
export interface Badge {
  label: string;
  tone: Tone;
}

export interface SidebarProps<K extends Kind = Kind> {
  item: ItemOf<K>;
  ctx: KindCtx;
}

/** "Add to canvas" support: the add dialog lists every kind that has this. */
export interface Addable {
  /** menu entry, e.g. "Import Jira ticket…" */
  label: string;
  /** input placeholder */
  hint: string;
  /** a typical input: `create` accepts it and `detect` (if any) recognises it (the registry test runs it) */
  example: string;
  /** the field is a prompt (multi-line) rather than a reference */
  multiline?: boolean;
  /** does a pasted reference look like this kind? (auto-switches the dialog) */
  detect?: (input: string) => boolean;
  /** build the new item from the input and the chosen project */
  create: (input: string, project: ItemOf<'project'> | undefined) => NewItem;
  /**
   * A custom add flow (a form, the chat box) used by the canvas *Add* menu and the add dialog
   * instead of the single input field. `create` still serves paste detection / tests.
   */
  open?: (at: { x: number; y: number }) => void;
  /**
   * The label of the link from a new item to the project picked in the add dialog (default
   * 'belongs to'); `false` = the kind never belongs to a project (no project picker).
   */
  linkLabel?: LinkLabel | false;
  /** add one to a given project (the project sidebar's section button); default: the add dialog */
  openIn?: (project: ItemOf<'project'>) => void;
}

/** A section listing a project's items of this kind in the project sidebar (and a count in its facts). */
export interface ProjectSection<K extends Kind = Kind> {
  /** plural heading / fact name, e.g. "Deployments" */
  label: string;
  /** button label, e.g. "Add deployment" (calls `addable.openIn`) */
  addLabel?: string;
  empty?: string;
  /** chip on a row (default: the kind's badge) */
  chip?: (item: ItemOf<K>) => Badge | undefined;
  /** an "open" button on a row */
  url?: (item: ItemOf<K>) => string | undefined;
  /** row tooltip */
  hint?: (item: ItemOf<K>) => string | undefined;
}

/** One background refresh job (`sync/refresher.ts` runs them with back-off and concurrency limits). */
export interface SyncJob {
  /** the item id; jobs shared by several items use another key (e.g. `checks:<repo>#<n>`), the first one wins */
  id: string;
  /** shared back-off key (e.g. `gh:<repo>`, `jira`), besides the job itself */
  group?: string;
  /** poll at the fast interval (something is running) */
  fast: boolean;
  run: () => Promise<void>;
}

/**
 * A kind backed by a process / session in main: its push events and the startup reconciliation
 * (`sync/live.ts` drives them). `L` is what main lists at start (sessions, processes).
 */
export interface LiveSync<K extends Kind = Kind, L = unknown> {
  /** subscribe to main's push events for this kind; returns the unsubscribe */
  start: () => () => void;
  /** what main runs now (startup reconciliation) */
  list(): Promise<L>;
  /** bring one item in line with `list`'s result (items that never really ran are left alone); method syntax so `L` may be narrower */
  reconcile(item: ItemOf<K>, running: L): void;
}

export interface KindModule<K extends Kind = Kind> {
  kind: K;
  /** singular, e.g. "Pull request" */
  label: string;
  icon: (size?: number) => ReactElement;
  /** bubble radius in world pixels */
  radius: number;
  /** position in the hierarchy: 0 = top (projects); related items of lower levels hug closer */
  level: number;
  /** status ring segments, derived from `data` (+ related items via ctx) */
  ring: (item: ItemOf<K>, ctx: KindCtx) => Segment[];
  /** key facts for the hover card / sidebar */
  facts: (item: ItemOf<K>, ctx: KindCtx) => [string, string][];
  /** secondary line in the hover card / sidebar; also searched by the filter */
  subtitle: (item: ItemOf<K>, ctx: KindCtx) => string | undefined;
  /** short text inside the bubble (key, #number, …); none = icon only */
  short?: (item: ItemOf<K>) => string | undefined;
  /** show the title inside the disc instead of a caption below it (projects) */
  titleInside?: boolean;
  /** chip on the bubble */
  badge?: (item: ItemOf<K>) => Badge | undefined;
  /** needs the user (pulses) */
  waiting?: (item: ItemOf<K>) => boolean;
  /** kind-specific actions for the given items (today always one); shared ones are added by `actionsForItem` */
  actions: (items: [ItemOf<K>], ctx: KindCtx) => Action[];
  /** id of the action double-click / Enter runs (default: the first enabled `primary` one) */
  primaryAction?: (item: ItemOf<K>, ctx: KindCtx) => string | undefined;
  /** "Mark done": the data patch it applies before archiving. Absent = the kind can only be archived. */
  complete?: (item: ItemOf<K>) => Partial<ItemOf<K>['data']>;
  /** label of the `complete` action (default "Mark done") */
  completeLabel?: string;
  /**
   * Actions for a multi-selection, given the selected items of this kind (`only`: every selected item
   * is of this kind). Their `run` gets the whole selection. Shared ones (ask, summary, link, archive) are added.
   */
  multiActions?: (items: ItemOf<K>[], only: boolean) => Action[];
  /**
   * What the item is, for the chat box's context block (`@handle = <this>`), e.g.
   * `GitHub pull request o/r#12 "Fix retry" (feat/x → main, open)`.
   */
  describe: (item: ItemOf<K>, ctx: KindCtx) => string;
  /** the item's working folder (agent sessions start there; it is a file root) */
  cwdOf?: (item: ItemOf<K>) => string | undefined;
  /** other folders / files the item points at (file roots for main besides `cwdOf`) */
  paths?: (item: ItemOf<K>) => (string | undefined)[];
  /** background refresh jobs for a (non-archived) item */
  sync?: (item: ItemOf<K>) => SyncJob[];
  /** push events / startup reconciliation for process-backed kinds */
  live?: LiveSync<K>;
  /** a section in the project sidebar listing the project's items of this kind */
  projectSection?: ProjectSection<K>;
  /** details panel body; default = `DefaultSidebar` (status, facts, connections) */
  Sidebar?: ComponentType<SidebarProps<K>>;
  addable?: Addable;
}

/** Every kind's module, for the registry. */
export type KindModules = { [K in Kind]: KindModule<K> };
