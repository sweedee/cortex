/** Domain types, inferred from the zod schemas (the schemas are the source of truth). */
import type { z } from 'zod';
import type {
  AgentDataSchema,
  AppDataSchema,
  BuildDataSchema,
  CameraSchema,
  ColorBySchema,
  DeploymentDataSchema,
  FilterSchema,
  ItemSchema,
  KINDS,
  LinkSchema,
  NoticeSchema,
  PrDataSchema,
  PrefsSchema,
  ProjectDataSchema,
  RecordDataSchema,
  SegmentSchema,
  StatusGroupSchema,
  TestRunDataSchema,
  TicketDataSchema,
  TodoDataSchema,
  ToneSchema,
  WorkspaceSchema,
  WorktreeDataSchema,
} from './schemas';

export type Kind = (typeof KINDS)[number];
export type Tone = z.infer<typeof ToneSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Notice = z.infer<typeof NoticeSchema>;
export type Link = z.infer<typeof LinkSchema>;

export type Item = z.infer<typeof ItemSchema>;
/** The item type of one kind, e.g. `ItemOf<'pr'>`. */
export type ItemOf<K extends Kind> = Extract<Item, { kind: K }>;
/** The `data` of one kind. */
export type DataOf<K extends Kind> = ItemOf<K>['data'];

export type ProjectData = z.infer<typeof ProjectDataSchema>;
export type TicketData = z.infer<typeof TicketDataSchema>;
export type WorktreeData = z.infer<typeof WorktreeDataSchema>;
export type RecordData = z.infer<typeof RecordDataSchema>;
export type PrData = z.infer<typeof PrDataSchema>;
export type AgentData = z.infer<typeof AgentDataSchema>;
export type AppData = z.infer<typeof AppDataSchema>;
export type BuildData = z.infer<typeof BuildDataSchema>;
export type DeploymentData = z.infer<typeof DeploymentDataSchema>;
export type TodoData = z.infer<typeof TodoDataSchema>;
export type TestRunData = z.infer<typeof TestRunDataSchema>;

export type StatusGroup = z.infer<typeof StatusGroupSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type ColorBy = z.infer<typeof ColorBySchema>;
export type Prefs = z.infer<typeof PrefsSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** A new item before the store stamps id / timestamps on it. */
export type NewItem = ToNew<Item>;
type ToNew<T> = T extends Item ? Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } : never;
