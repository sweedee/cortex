/**
 * zod schemas for every invoke channel's request. Main validates each incoming request
 * with these before doing anything; the renderer may import them too (Phase 0b) but the
 * preload must not (it is sandboxed and only bundles `ipc.ts`).
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
const arg = z.string().max(32_768).refine((a) => !a.includes('\0'), 'argument must not contain NUL');

export const execRunSchema = z.object({
  cmd: z.enum(EXEC_ALLOWLIST),
  args: z.array(arg).max(1000),
  cwd: absPath,
  env,
  timeoutMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
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

const httpUrl = z
  .string()
  .max(8192)
  .refine((u) => {
    try {
      const p = new URL(u).protocol;
      return p === 'http:' || p === 'https:';
    } catch {
      return false;
    }
  }, 'only http(s) URLs can be opened');

const filters = z.array(z.object({ name: z.string(), extensions: z.array(z.string().regex(/^[\w*.-]+$/)) })).optional();

/** Request schema per channel; `z.void()` for channels without a payload. */
export const schemas = {
  'exec:run': execRunSchema,
  'proc:start': procStartSchema,
  'proc:stop': z.object({ id: z.string().min(1) }),
  'proc:list': z.undefined(),
  // all-optional requests: `pickDirectory()` sends no request at all
  'dialog:pickDirectory': z.object({ title: z.string().optional(), defaultPath: absPath.optional() }).default({}),
  'dialog:pickFile': z.object({ title: z.string().optional(), defaultPath: absPath.optional(), filters }).default({}),
  'shell:openExternal': z.object({ url: httpUrl }),
  'shell:openPath': z.object({ path: absPath }),
  'shell:openInEditor': z.object({ path: absPath }),
  'webview:setColorScheme': z.object({ webContentsId: z.number().int().nonnegative(), scheme: z.enum(['light', 'dark']).nullable() }),
  'notify:desktop': z.object({ title: z.string().max(500), body: z.string().max(5000), tag: z.string().max(500).optional(), itemId: z.string().optional() }),
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
