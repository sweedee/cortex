/**
 * The contract every kind module (`kinds/<kind>/index.tsx`) implements. The canvas, HUD,
 * sidebar and chat box only talk to kinds through this interface (via `getKind` and the
 * helpers in `registry.ts`), never through `switch (item.kind)`.
 */
import type { ComponentType, ReactElement } from 'react';
import type { Item, ItemOf, Kind, Link, NewItem, Segment, Tone } from '../domain';

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
  actions: (items: ItemOf<K>[], ctx: KindCtx) => Action[];
  /** id of the action double-click / Enter runs (default: the first enabled `primary` one) */
  primaryAction?: (item: ItemOf<K>, ctx: KindCtx) => string | undefined;
  /** "Mark done": the data patch it applies before archiving. Absent = the kind can only be archived. */
  complete?: (item: ItemOf<K>) => Partial<ItemOf<K>['data']>;
  /** details panel body; default = `DefaultSidebar` (status, facts, connections) */
  Sidebar?: ComponentType<SidebarProps<K>>;
  addable?: Addable;
}

/** Every kind's module, for the registry. */
export type KindModules = { [K in Kind]: KindModule<K> };
