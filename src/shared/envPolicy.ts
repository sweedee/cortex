import { z } from 'zod';

/**
 * Environment variables the renderer may set on a child process (`exec:run`, `proc:start`,
 * `apps:start`, `tests:run`). An allowlist, not a denylist: anything that changes how a program
 * loads code (NODE_OPTIONS, LD_PRELOAD, DYLD_*, GIT_SSH_COMMAND, GIT_EXEC_PATH, ELECTRON_*, PATH …)
 * is refused simply by not being listed. Used by both schema modules.
 * Main's own spawns (services, runners) are not limited by this.
 */
export const RENDERER_ENV_KEYS = ['FORCE_COLOR', 'NO_COLOR', 'CI', 'NODE_ENV', 'PORT', 'HOST', 'BROWSER', 'DEBUG', 'TZ', 'LANG', 'LC_ALL'] as const;

const allowed = new Set<string>(RENDERER_ENV_KEYS);

/** exact (case-sensitive) match: `node_options` is refused just like `NODE_OPTIONS` */
export const isRendererEnvKey = (key: string): boolean => allowed.has(key);

/** the keys of `env` the renderer may not set (empty when all are fine) */
export const refusedEnvKeys = (env: Record<string, string>): string[] => Object.keys(env).filter((k) => !isRendererEnvKey(k));

/** the `env` field of a request: optional, allowlisted keys only, no NUL */
export const envSchema = z
  .record(
    z.string(),
    z
      .string()
      .max(32_768)
      .refine((v) => !v.includes('\0'), 'env values must not contain NUL'),
  )
  .superRefine((env, ctx) => {
    const bad = refusedEnvKeys(env);
    if (bad.length) ctx.addIssue({ code: 'custom', message: `env: ${bad.join(', ')} may not be set (allowed: ${RENDERER_ENV_KEYS.join(', ')})` });
  })
  .optional();
