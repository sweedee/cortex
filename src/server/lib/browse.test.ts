import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browseDir, checkPick } from './browse';
import { PathNotAllowedError, type PathEnv } from './pathPolicy';

let home: string;
let env: PathEnv;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'cortex-browse-'));
  env = { platform: process.platform, home, userData: join(home, '.cortex') };
  mkdirSync(join(home, 'repo'));
  mkdirSync(join(home, 'b-dir'));
  mkdirSync(join(home, '.ssh'));
  writeFileSync(join(home, 'a.txt'), 'x');
  writeFileSync(join(home, '.env'), 'secret');
  if (process.platform !== 'win32') symlinkSync(join(home, 'repo'), join(home, 'link'));
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('browseDir', () => {
  it('lists names only, folders first, no hidden entries; defaults to home', async () => {
    const r = await browseDir(undefined, env);
    expect(r.path).toBe(home);
    expect(r.parent).toBe(join(home, '..'));
    const names = r.entries.map((e) => e.name);
    expect(names).not.toContain('.ssh');
    expect(names).not.toContain('.env');
    expect(r.entries[0]).toEqual({ name: 'b-dir', dir: true });
    expect(r.entries.at(-1)).toEqual({ name: 'a.txt', dir: false });
  });

  it.skipIf(process.platform === 'win32')('a symlink counts as what it points at', async () => {
    expect((await browseDir(home, env)).entries).toContainEqual({ name: 'link', dir: true });
  });

  it('truncates long listings and stops at the root', async () => {
    const r = await browseDir(home, env, 1);
    expect(r.entries).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect((await browseDir('/', { ...env, platform: 'linux' }).catch(() => ({ parent: null }))).parent).toBeNull();
  });

  it('refuses hidden home folders and missing paths', async () => {
    await expect(browseDir(join(home, '.ssh'), env)).rejects.toBeInstanceOf(PathNotAllowedError);
    await expect(browseDir(join(home, 'nope'), env)).rejects.toThrow(/no such folder/);
    await expect(browseDir(join(home, 'a.txt'), env)).rejects.toThrow(/no such folder/);
  });
});

describe('checkPick', () => {
  it('checks existence and kind', async () => {
    expect(await checkPick(join(home, 'repo'), 'dir')).toBe(join(home, 'repo'));
    expect(await checkPick(join(home, 'a.txt'), 'file')).toBe(join(home, 'a.txt'));
    await expect(checkPick(join(home, 'a.txt'), 'dir')).rejects.toThrow(/not a folder/);
    await expect(checkPick(join(home, 'repo'), 'file')).rejects.toThrow(/not a file/);
    await expect(checkPick(join(home, 'gone'), 'dir')).rejects.toThrow(/does not exist/);
  });
});
