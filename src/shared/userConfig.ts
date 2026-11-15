/**
 * The user / machine config: `<userData>/config.json` (`~/.cortex/config.json`). One zod schema for
 * main (loader, `config:*` channels) and the renderer (the settings it mirrors, pure helpers).
 *
 * Every field has a `.catch(default)`, every object too: a bad value falls back to its own default
 * instead of failing the file (or startup), unknown keys are ignored. Resolution in main:
 * `DEFAULT_USER_CONFIG` ← `config.json` ← env (dev builds only, see `src/main/services/config.ts`).
 *
 * Trust: the renderer may only change the keys in `RendererConfigPatchSchema` (`config:update`);
 * `editor.*` and `claude.bin` name programs main runs, so they come from the file only.
 */
import { z } from 'zod';
import { EFFORT_LEVELS, PERMISSION_MODES } from './integrations/claude';
import { JIRA_FIELDS } from './integrations/jira';

const text = (max = 1000) => z.string().min(1).max(max).refine((s) => !s.includes('\0'), 'must not contain NUL');
/** a program / argument: no NUL, no leading `-` for the program */
const program = text(4096).refine((s) => !s.startsWith('-'), 'must not start with "-"');
/** a folder relative to a base checkout: no absolute path, no `..` */
const relDir = text(500).refine((s) => !/^(?:[a-zA-Z]:|[\\/])/.test(s) && !s.split(/[\\/]/).includes('..'), 'must be a relative folder inside the checkout (no "..")');
/** a bare host name, optionally with a port: no scheme, path or credentials */
const hostName = z.string().regex(/^[A-Za-z0-9.-]+(?::\d{1,5})?$/, 'expected a host name like github.com');
const customField = z.string().regex(/^customfield_\d+$/, 'expected customfield_<number>');
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** `default` = no `--permission-mode` flag (the CLI asks for tools it may not run) */
export const CONFIG_PERMISSION_MODES = ['default', ...PERMISSION_MODES] as const;
export type ConfigPermissionMode = (typeof CONFIG_PERMISSION_MODES)[number];

/** Claude Code's default context window, until the CLI reports the real one with the first result. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** `z.object(shape)` that falls back to its all-defaults value when it is not an object at all. */
function section<S extends z.ZodRawShape>(shape: S, description: string) {
  const o = z.object(shape);
  return o.catch(() => o.parse({})).describe(description);
}

export const UserConfigSchema = z.object({
  editor: section(
    {
      command: program.catch('code').describe('Editor program for "Open in editor" (on PATH or absolute; Windows .cmd shims work). File-only: the app never changes it.'),
      args: z.array(text(4096)).max(50).catch(['{path}']).describe('Arguments; {path} is replaced by the file or folder. Without {path} the path is appended.'),
    },
    'Open in editor. Read from this file only (not editable in the app).',
  ),
  claude: section(
    {
      bin: program.catch('claude').describe('Claude Code binary (on PATH or absolute). File-only; restart Cortex after a change.'),
      model: text(200).nullable().catch(null).describe('claude --model for new sessions; null = the CLI default'),
      effort: z.enum(EFFORT_LEVELS).nullable().catch(null).describe('claude --effort for new sessions; null = the CLI default'),
      permissionMode: z.enum(CONFIG_PERMISSION_MODES).catch('default').describe('claude --permission-mode for new sessions ("default" = no flag)'),
      contextWindow: int(1000, 100_000_000).catch(DEFAULT_CONTEXT_WINDOW).describe('Context window (tokens) assumed until a session reports its own'),
    },
    'Claude Code',
  ),
  github: section(
    {
      host: hostName.catch('github.com').describe('GitHub host for repo links (GitHub Enterprise: github.example.com). File-only.'),
      aiReviewComment: text(65_536).catch('@claude review').describe('PR comment posted by "Request AI review"'),
      aiReviewBot: text(200).catch('claude[bot]').describe('Login of the bot that answers it'),
      renovate: section(
        {
          app: z.string().regex(/^[\w.-]+$/, 'expected a GitHub App slug').catch('renovate').describe('Renovate GitHub App slug (gh pr list --app)'),
          label: text(200).catch('renovate').describe('Label Renovate (or Dependabot) PRs carry'),
        },
        'Dependency-update PRs',
      ),
    },
    'GitHub',
  ),
  jira: section(
    {
      cli: z.enum(['acli', 'mock']).catch('acli').describe('"acli" = the Atlassian CLI on PATH; "mock" = the bundled Jira mock'),
      site: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).catch('').describe('Jira site for links (https://acme.atlassian.net); "" = from acli auth status'),
      fields: section(
        {
          storyPoints: customField.catch(JIRA_FIELDS.storyPoints).describe('Custom field id of story points (acli jira workitem view <KEY> --json --fields "*all")'),
          sprint: customField.catch(JIRA_FIELDS.sprint).describe('Custom field id of the sprint'),
        },
        'Custom field ids: these differ per Jira site',
      ),
    },
    'Jira',
  ),
  git: section(
    {
      branchTemplate: text(200).catch('{key}-{slug}').describe('Branch name for a ticket: {key} = issue key, {slug} = title slug (e.g. feat/{key}-{slug})'),
      defaultBranch: text(200).refine((s) => !s.startsWith('-'), 'must not start with "-"').catch('main').describe('Default branch when a project has none'),
      worktreesDir: text(1000).catch('../wt/{repo}').describe('Default worktrees folder of a new project, relative to its base checkout or absolute; {repo} = the checkout folder name'),
    },
    'git',
  ),
  records: section({ dir: relDir.catch('records').describe('Records folder inside each base checkout (e.g. .cortex/records, docs/plans)') }, 'Records (markdown plans)'),
  refresh: section(
    {
      intervalSec: int(10, 3600).catch(60).describe('Background refresh of git / GitHub / Jira caches, seconds'),
      fastSec: int(5, 3600).catch(15).describe('Refresh interval while PR checks or builds run, seconds (never slower than intervalSec). File-only.'),
      parallel: int(1, 16).catch(3).describe('Refresh jobs run at the same time. File-only.'),
    },
    'Background refresh',
  ),
  limits: section(
    {
      execTimeoutSec: int(1, 86_400).catch(120).describe('Default time limit of a git / gh / claude command, seconds. File-only; applies at once.'),
      rebaseTimeoutSec: int(1, 86_400).catch(300).describe('Time limit of "git rebase", seconds. File-only; applies at once.'),
      outputCapMb: int(1, 1024).catch(20).describe('Output kept per stream of a command, megabytes (more is cut off). File-only; applies at once.'),
    },
    'Limits',
  ),
  ui: section(
    {
      notifications: z.boolean().catch(false).describe('Desktop notifications when Cortex is in the background'),
      sound: z.boolean().catch(true).describe('Chime for new notices'),
      theme: z.enum(['dark', 'light', 'system']).catch('system').describe('Colour theme; "system" follows the OS'),
      animations: z.boolean().catch(true).describe('Backdrop particles and floating bubbles (off = still; the OS "reduce motion" setting always wins)'),
    },
    'UI',
  ),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const DEFAULT_USER_CONFIG: UserConfig = UserConfigSchema.parse({});

/** Any JSON → a complete config (never throws). */
export const parseUserConfig = (raw: unknown): UserConfig => UserConfigSchema.parse(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});

/**
 * What the renderer may change (`config:update`): the gear dialog's settings. Strict, so anything
 * else (`editor`, `claude.bin`, Jira fields, …) is rejected: those stay file-only. `null` removes a
 * key from the file (= its default; for model / effort: the CLI default).
 */
export const RendererConfigPatchSchema = z.strictObject({
  claude: z
    .strictObject({
      model: text(200).nullable(),
      effort: z.enum(EFFORT_LEVELS).nullable(),
      permissionMode: z.enum(CONFIG_PERMISSION_MODES),
    })
    .partial()
    .optional(),
  github: z.strictObject({ aiReviewComment: text(65_536).nullable() }).partial().optional(),
  refresh: z.strictObject({ intervalSec: int(10, 3600) }).partial().optional(),
  ui: z.strictObject({ notifications: z.boolean(), sound: z.boolean(), theme: z.enum(['dark', 'light', 'system']), animations: z.boolean() }).partial().optional(),
});

export type UserConfigPatch = z.infer<typeof RendererConfigPatchSchema>;

export interface ConfigUpdateRequest {
  patch: UserConfigPatch;
  /** only fill keys config.json doesn't set yet (the one-time move of workspace prefs) */
  ifUnset?: boolean;
}

/** `config:get` / `config:update` / `config:changed`: the effective config and where it lives. */
export interface UserConfigState {
  config: UserConfig;
  /** absolute path of config.json */
  path: string;
  /** why config.json was not used as it is (unreadable JSON, values that fell back to their default) */
  problems: string[];
}

/** Deep-merge a patch into a raw JSON object (objects merge, `null` removes the key = its default, everything else replaces). */
export function mergePatch(base: Record<string, unknown>, patch: Record<string, unknown>, ifUnset = false): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
    if (ifUnset && k in out && !isObj(v)) continue;
    if (v === null) delete out[k];
    else if (isObj(v)) out[k] = mergePatch(isObj(cur) ? cur : {}, v, ifUnset);
    else out[k] = v;
  }
  return out;
}

/** Values of `raw` that are invalid and fell back to the default (`"claude.contextWindow"`), for a warning. */
export function configProblems(raw: unknown, path: string[] = []): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return path.length ? [path.join('.')] : [];
  const problems: string[] = [];
  const check = (schema: z.ZodType, value: unknown, at: string[]) => {
    const unwrapped = unwrapCatch(schema);
    if (unwrapped instanceof z.ZodObject) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return problems.push(at.join('.'));
      for (const [k, s] of Object.entries(unwrapped.shape as Record<string, z.ZodType>)) if (k in (value as object)) check(s, (value as Record<string, unknown>)[k], [...at, k]);
      return;
    }
    if (!unwrapped.safeParse(value).success) problems.push(at.join('.'));
  };
  check(UserConfigSchema, raw, path);
  return problems;
}

function unwrapCatch(s: z.ZodType): z.ZodType {
  return s instanceof z.ZodCatch ? unwrapCatch(s.unwrap() as z.ZodType) : s;
}

/** JSON schema of config.json (written next to it for editor completion), without `required`. */
export function userConfigJsonSchema(): Record<string, unknown> {
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== 'object') return n;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) if (k !== 'required') o[k] = strip(v);
    return o;
  };
  const schema = z.toJSONSchema(UserConfigSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  return strip({ ...schema, title: 'Cortex config (~/.cortex/config.json)', properties: { $schema: { type: 'string' }, ...props }, additionalProperties: false }) as Record<string, unknown>;
}

// ---- templates (pure; used by main and the renderer) ---------------------------------------

/** `{key}-{slug}` → `CTX-12-retry-backoff`. Empty parts and their stray separators are dropped. */
export function renderBranchTemplate(template: string, vars: { key: string; slug: string }): string {
  const out = template.replace(/\{(key|slug)\}/g, (_, k: 'key' | 'slug') => vars[k]);
  return out
    .replace(/([/_.-])[/_.-]+/g, '$1')
    .replace(/^[/_.-]+|[/_.-]+$/g, '')
    .replace(/\s+/g, '-');
}

/** Editor args with `{path}` replaced; no `{path}` anywhere → the path is appended. */
export function editorArgs(args: readonly string[], path: string): string[] {
  const has = args.some((a) => a.includes('{path}'));
  const out = args.map((a) => a.split('{path}').join(path));
  return has ? out : [...out, path];
}

/** Request schemas of the `config:*` channels (spread into `schemas` in ./schemas.ts). */
export const configSchemas = {
  'config:get': z.undefined(),
  'config:update': z.strictObject({ patch: RendererConfigPatchSchema, ifUnset: z.boolean().optional() }),
};

/** Web URL of a repo (or a path in it) on the configured GitHub host. */
export const repoUrl = (host: string, repo: string, path = '') => `https://${host}/${repo}${path}`;
