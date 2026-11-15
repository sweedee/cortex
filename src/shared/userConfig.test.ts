import { describe, expect, it } from 'vitest';
import { schemas } from './schemas';
import {
  configProblems,
  DEFAULT_USER_CONFIG,
  editorArgs,
  mergePatch,
  parseUserConfig,
  RendererConfigPatchSchema, repoUrl,
  renderBranchTemplate,
  userConfigJsonSchema,
  UserConfigSchema,
} from './userConfig';

/** every leaf of the config as a path (`['claude', 'model']`) */
function leaves(o: Record<string, unknown>, at: string[] = []): string[][] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v as Record<string, unknown>, [...at, k]) : [[...at, k]]));
}
const withValue = (path: string[], value: unknown): Record<string, unknown> => path.reduceRight<unknown>((acc, k) => ({ [k]: acc }), value) as Record<string, unknown>;
const get = (o: unknown, path: string[]) => path.reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o);

describe('user config schema', () => {
  it('has defaults for everything (the documented ones)', () => {
    expect(DEFAULT_USER_CONFIG).toMatchObject({
      editor: { command: 'code', args: ['{path}'] },
      claude: { bin: 'claude', model: null, effort: null, permissionMode: 'default', contextWindow: 200_000 },
      github: { host: 'github.com', aiReviewComment: '@claude review', aiReviewBot: 'claude[bot]', renovate: { app: 'renovate', label: 'renovate' } },
      jira: { cli: 'acli', site: '', fields: { storyPoints: 'customfield_10016', sprint: 'customfield_10020' } },
      git: { branchTemplate: '{key}-{slug}', defaultBranch: 'main', worktreesDir: '../wt/{repo}' },
      records: { dir: 'records' },
      refresh: { intervalSec: 60, fastSec: 15, parallel: 3 },
      limits: { execTimeoutSec: 120, rebaseTimeoutSec: 300, outputCapMb: 20 },
      ui: { notifications: false, sound: true, theme: 'system', animations: true },
    });
    expect(parseUserConfig(null)).toEqual(DEFAULT_USER_CONFIG);
    expect(parseUserConfig([1, 2])).toEqual(DEFAULT_USER_CONFIG);
  });

  it('a bad value falls back to its own default, field by field, and the rest survives', () => {
    const paths = leaves(DEFAULT_USER_CONFIG);
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      const raw: Record<string, unknown> = { ...withValue(path, { not: 'valid' }) };
      if (path[0] !== 'refresh') raw.refresh = { intervalSec: 120 };
      const c = UserConfigSchema.parse(raw);
      expect(get(c, path), path.join('.')).toEqual(get(DEFAULT_USER_CONFIG, path));
      expect(c.refresh.intervalSec).toBe(path[0] === 'refresh' ? 60 : 120);
      expect(configProblems(raw)).toContain(path.join('.'));
    }
  });

  it('a section that is not an object falls back as a whole; unknown keys are ignored', () => {
    const c = parseUserConfig({ claude: 'opus', $schema: './config.schema.json', extra: 1, git: { branchTemplate: 'feat/{key}-{slug}', nope: true } });
    expect(c.claude).toEqual(DEFAULT_USER_CONFIG.claude);
    expect(c.git.branchTemplate).toBe('feat/{key}-{slug}');
    expect(c).not.toHaveProperty('extra');
    expect(configProblems({ claude: 'opus' })).toEqual(['claude']);
  });

  it('validates the risky values', () => {
    expect(parseUserConfig({ editor: { command: '--inspect' } }).editor.command).toBe('code');
    expect(parseUserConfig({ records: { dir: '../outside' } }).records.dir).toBe('records');
    expect(parseUserConfig({ records: { dir: 'C:/abs' } }).records.dir).toBe('records');
    expect(parseUserConfig({ records: { dir: '.cortex/records' } }).records.dir).toBe('.cortex/records');
    expect(parseUserConfig({ jira: { fields: { storyPoints: 'points' } } }).jira.fields.storyPoints).toBe('customfield_10016');
    expect(parseUserConfig({ jira: { fields: { storyPoints: 'customfield_10028' } } }).jira.fields.storyPoints).toBe('customfield_10028');
    expect(parseUserConfig({ jira: { site: 'javascript:alert(1)' } }).jira.site).toBe('');
    expect(parseUserConfig({ jira: { site: 'https://acme.atlassian.net' } }).jira.site).toBe('https://acme.atlassian.net');
    expect(parseUserConfig({ refresh: { intervalSec: 5 } }).refresh.intervalSec).toBe(60);
  });

  it('writes a JSON schema without required keys, with $schema allowed', () => {
    const s = userConfigJsonSchema();
    expect(JSON.stringify(s)).not.toContain('"required"');
    expect((s.properties as Record<string, unknown>).$schema).toEqual({ type: 'string' });
    expect(JSON.stringify(s)).toContain('customfield_10016');
  });
});

describe('renderer config patches', () => {
  it('allow the gear-dialog settings only', () => {
    expect(RendererConfigPatchSchema.parse({ claude: { model: 'opus', effort: null }, ui: { sound: false } })).toEqual({ claude: { model: 'opus', effort: null }, ui: { sound: false } });
    expect(() => RendererConfigPatchSchema.parse({ editor: { command: 'calc.exe' } })).toThrow(/editor/);
    expect(() => RendererConfigPatchSchema.parse({ claude: { bin: '/tmp/evil' } })).toThrow(/bin/);
    expect(() => RendererConfigPatchSchema.parse({ jira: { cli: 'mock' } })).toThrow(/jira/);
    expect(() => RendererConfigPatchSchema.parse({ refresh: { intervalSec: 1 } })).toThrow(/10/);
    expect(() => schemas['config:update'].parse({ patch: { editor: { args: ['-c', '!calc'] } } })).toThrow(/editor/);
    expect(schemas['config:update'].parse({ patch: { github: { aiReviewComment: '/review' } }, ifUnset: true })).toBeTruthy();
  });

  it('merge into the file: objects merge, null removes, ifUnset keeps what is there', () => {
    const file = { claude: { bin: 'C:/claude.exe', model: 'opus' }, git: { branchTemplate: 'x/{key}' } };
    expect(mergePatch(file, { claude: { model: null, effort: 'high' }, ui: { sound: false } })).toEqual({
      claude: { bin: 'C:/claude.exe', effort: 'high' },
      git: { branchTemplate: 'x/{key}' },
      ui: { sound: false },
    });
    expect(mergePatch(file, { claude: { model: 'sonnet', permissionMode: 'plan' } }, true)).toEqual({ ...file, claude: { bin: 'C:/claude.exe', model: 'opus', permissionMode: 'plan' } });
  });
});

describe('templates', () => {
  it('renders the branch template', () => {
    expect(renderBranchTemplate('{key}-{slug}', { key: 'CTX-12', slug: 'retry-backoff' })).toBe('CTX-12-retry-backoff');
    expect(renderBranchTemplate('feat/{key}-{slug}', { key: 'CTX-12', slug: 'retry' })).toBe('feat/CTX-12-retry');
    expect(renderBranchTemplate('user/sven/{key}', { key: 'CTX-12', slug: 'x' })).toBe('user/sven/CTX-12');
    // empty parts don't leave stray separators
    expect(renderBranchTemplate('{key}-{slug}', { key: 'CTX-1', slug: '' })).toBe('CTX-1');
    expect(renderBranchTemplate('feat/{key}-{slug}', { key: '', slug: 'retry' })).toBe('feat/retry');
    expect(renderBranchTemplate('{slug} {key}', { key: 'A-1', slug: 'x' })).toBe('x-A-1');
  });

  it('templates the editor args', () => {
    expect(editorArgs(['{path}'], 'C:/a b/c.ts')).toEqual(['C:/a b/c.ts']);
    expect(editorArgs(['--goto', '{path}:1'], '/x/y')).toEqual(['--goto', '/x/y:1']);
    expect(editorArgs(['-n'], '/x/y')).toEqual(['-n', '/x/y']);
    expect(editorArgs([], '/x/y')).toEqual(['/x/y']);
  });

  it('new fields: bad values fall back, valid ones stick, only theme / animations are renderer-patchable', () => {
    const c = parseUserConfig({ ui: { theme: 'sepia', animations: 'no' }, limits: { execTimeoutSec: -1, rebaseTimeoutSec: 600, outputCapMb: 5 }, refresh: { fastSec: 'x', parallel: 8 }, github: { host: 'https://evil/x' } });
    expect(c.ui).toMatchObject({ theme: 'system', animations: true });
    expect(c.limits).toEqual({ execTimeoutSec: 120, rebaseTimeoutSec: 600, outputCapMb: 5 });
    expect(c.refresh).toMatchObject({ fastSec: 15, parallel: 8 });
    expect(c.github.host).toBe('github.com');
    expect(parseUserConfig({ github: { host: 'ghe.example.com' } }).github.host).toBe('ghe.example.com');
    expect(RendererConfigPatchSchema.parse({ ui: { theme: 'dark', animations: false } })).toEqual({ ui: { theme: 'dark', animations: false } });
    for (const bad of [{ limits: { execTimeoutSec: 5 } }, { refresh: { parallel: 2 } }, { github: { host: 'x.com' } }]) expect(RendererConfigPatchSchema.safeParse(bad).success).toBe(false);
    expect(repoUrl('ghe.example.com', 'o/r', '/pull/3')).toBe('https://ghe.example.com/o/r/pull/3');
  });
});
