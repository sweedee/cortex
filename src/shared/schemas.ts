/**
 * zod schemas for every invoke channel's request. The server validates each incoming request
 * with these before doing anything; the renderer may import them too.
 */
import { z } from 'zod';
import { EXEC_ALLOWLIST, type InvokeChannel, type Req } from './ipc';
import { envSchema } from './envPolicy';
import { integrationSchemas } from './integrationSchemas';
import { configSchemas } from './userConfig';

const isAbsolute = (p: string) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(p);
/** an absolute path on any platform (C:\…, \\server\…, /…), no NUL bytes */
export const absPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes('\0'), 'path must not contain NUL')
  .refine(isAbsolute, 'path must be absolute');

const env = envSchema;
const arg = z
  .string()
  .max(32_768)
  .refine((a) => !a.includes('\0'), 'argument must not contain NUL');

export const execRunSchema = z.object({
  cmd: z.enum(EXEC_ALLOWLIST),
  args: z.array(arg).max(1000),
  cwd: absPath,
  env,
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 1000)
    .optional(),
  stdin: z.string().optional(),
});

export const procStartSchema = z.object({
  id: z.string().min(1).max(200),
  cmd: z.string().min(1).max(4096),
  args: z.array(arg).max(1000),
  cwd: absPath,
  env,
  shell: z.boolean().optional(),
});

/** Request schema per channel; `z.void()` for channels without a payload. */
export const schemas = {
  'exec:run': execRunSchema,
  'proc:start': procStartSchema,
  'proc:stop': z.object({ id: z.string().min(1) }),
  'proc:list': z.undefined(),
  // all-optional requests: `listDir()` sends no request at all
  'dialog:listDir': z.strictObject({ path: absPath.optional() }).default({}),
  'dialog:confirmPick': z.strictObject({ path: absPath, kind: z.enum(['dir', 'file']) }),
  'shell:openPath': z.object({ path: absPath }),
  'shell:openInEditor': z.object({ path: absPath }),
  'workspace:load': z.undefined(),
  'workspace:save': z.object({ data: z.unknown() }),
  'workspace:path': z.undefined(),
  'fs:readText': z.object({ path: absPath }),
  'fs:writeText': z.object({ path: absPath, text: z.string() }),
  'fs:list': z.object({ dir: absPath, options: z.object({ glob: z.string().max(1000).optional() }).optional() }),
  'fs:watch': z.object({ dir: absPath }),
  'fs:unwatch': z.object({ watchId: z.string() }),
  'fs:setRoots': z.object({ roots: z.array(absPath).max(5000) }),
  'app:info': z.undefined(),
  ...integrationSchemas,
  ...configSchemas,
} satisfies { [C in InvokeChannel]: z.ZodType };

/** Compile-time check: every schema parses to (a subtype of) the channel's request type. */
type SchemaMatches = { [C in InvokeChannel]: z.infer<(typeof schemas)[C]> extends Req<C> ? true : false };
const schemasMatchContract: { [C in InvokeChannel]: true } = null as unknown as SchemaMatches;
void schemasMatchContract;
/** ...and no schema for a channel the contract doesn't declare (the spreads above escape `satisfies`). */
const noStraySchemas: [Exclude<keyof typeof schemas, InvokeChannel>] extends [never] ? true : never = true;
void noStraySchemas;
