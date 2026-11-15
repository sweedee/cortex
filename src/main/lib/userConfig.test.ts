import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_CONFIG } from '../../shared/userConfig';
import { CONFIG_FILE, CONFIG_SCHEMA_FILE, isConfigFile, STARTER_CONFIG, UserConfigStore } from './userConfig';

describe('UserConfigStore', () => {
  let dir: string;
  const file = () => join(dir, CONFIG_FILE);
  const readJson = () => JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cortex-config-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('no file: the defaults; first run writes a starter file and the schema', () => {
    const s = new UserConfigStore(dir);
    expect(s.config).toEqual(DEFAULT_USER_CONFIG);
    expect(s.state).toMatchObject({ path: file(), problems: [] });
    s.ensureFiles();
    expect(readFileSync(file(), 'utf8')).toBe(STARTER_CONFIG);
    expect(JSON.parse(readFileSync(join(dir, CONFIG_SCHEMA_FILE), 'utf8'))).toHaveProperty('properties.jira');
    expect(s.reload().config).toEqual(DEFAULT_USER_CONFIG);
  });

  it('never overwrites an existing config.json', () => {
    writeFileSync(file(), JSON.stringify({ git: { branchTemplate: 'feat/{key}-{slug}' } }));
    const s = new UserConfigStore(dir);
    s.ensureFiles();
    expect(readJson()).toEqual({ git: { branchTemplate: 'feat/{key}-{slug}' } });
    expect(s.config.git.branchTemplate).toBe('feat/{key}-{slug}');
  });

  it('reports invalid values and falls back for them only', () => {
    writeFileSync(file(), JSON.stringify({ refresh: { intervalSec: 2 }, ui: { sound: false } }));
    const s = new UserConfigStore(dir);
    expect(s.config.refresh.intervalSec).toBe(60);
    expect(s.config.ui.sound).toBe(false);
    expect(s.state.problems).toEqual(['invalid value for "refresh.intervalSec", using the default']);
  });

  it('writes patches: keeps the keys of the file, adds only the patch (no frozen defaults)', async () => {
    writeFileSync(file(), JSON.stringify({ $schema: './config.schema.json', editor: { command: 'cursor' }, claude: { model: 'opus' } }));
    const s = new UserConfigStore(dir);
    const r = await s.update({ patch: { claude: { model: null, effort: 'high' }, ui: { sound: false } } });
    expect(readJson()).toEqual({ $schema: './config.schema.json', editor: { command: 'cursor' }, claude: { effort: 'high' }, ui: { sound: false } });
    expect(r.config).toMatchObject({ editor: { command: 'cursor' }, claude: { model: null, effort: 'high' }, ui: { sound: false } });
  });

  it('ifUnset: the one-time move of workspace prefs does not override the file', async () => {
    writeFileSync(file(), JSON.stringify({ claude: { model: 'opus' } }));
    const s = new UserConfigStore(dir);
    await s.update({ patch: { claude: { model: 'sonnet', permissionMode: 'plan' } }, ifUnset: true });
    expect(s.config.claude).toMatchObject({ model: 'opus', permissionMode: 'plan' });
  });

  it('a file with broken JSON: defaults, a problem, and no writes over it', async () => {
    writeFileSync(file(), '{ "claude": { "model": "opus", } ');
    const s = new UserConfigStore(dir);
    expect(s.config).toEqual(DEFAULT_USER_CONFIG);
    expect(s.state.problems[0]).toMatch(/not valid JSON/);
    await expect(s.update({ patch: { ui: { sound: false } } })).rejects.toThrow(/Fix the file first/);
    expect(readFileSync(file(), 'utf8')).toContain('"opus", }');
  });

  it('reload notifies only when the effective config changed', () => {
    const s = new UserConfigStore(dir);
    const seen: unknown[] = [];
    s.onChange((st) => seen.push(st.config.ui.sound));
    s.reload();
    expect(seen).toEqual([]);
    writeFileSync(file(), JSON.stringify({ ui: { sound: false } }));
    s.reload();
    s.reload();
    expect(seen).toEqual([false]);
  });

  it('recognises its files for the fs:writeText guard', () => {
    expect(isConfigFile(join(dir, 'config.json'), dir)).toBe(true);
    expect(isConfigFile(join(dir, 'sub', '..', 'config.schema.json'), dir)).toBe(true);
    expect(isConfigFile(join(dir, 'CONFIG.JSON'), dir, 'win32')).toBe(true);
    expect(isConfigFile(join(dir, 'workspace.json'), dir)).toBe(false);
  });
});
