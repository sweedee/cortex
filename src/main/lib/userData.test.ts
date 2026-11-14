import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateUserData, resolveUserData } from './userData';

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('user data location', () => {
  it('defaults to ~/.cortex, Chromium data in Electron’s folder; CORTEX_USER_DATA overrides both', () => {
    expect(resolveUserData({}, 'C:/AppData/cortex', 'C:/Users/me')).toEqual({ userData: join('C:/Users/me', '.cortex'), sessionData: 'C:/AppData/cortex' });
    expect(resolveUserData({ CORTEX_USER_DATA: 'C:/tmp/p' }, 'C:/AppData/cortex', 'C:/Users/me')).toEqual({ userData: 'C:/tmp/p', sessionData: join('C:/tmp/p', 'chromium') });
  });

  it('copies the old files once when ~/.cortex has no workspace yet', () => {
    dir = mkdtempSync(join(tmpdir(), 'cortex-ud-'));
    const from = join(dir, 'old');
    const to = join(dir, 'new');
    mkdirSync(from);
    writeFileSync(join(from, 'workspace.json'), '{"version":2}');
    writeFileSync(join(from, 'window-state.json'), '{}');
    writeFileSync(join(from, 'Cookies'), 'x');
    expect(migrateUserData(from, to)).toEqual(['workspace.json', 'window-state.json']);
    expect(readFileSync(join(to, 'workspace.json'), 'utf8')).toBe('{"version":2}');
    writeFileSync(join(from, 'workspace.json'), '{"version":3}');
    expect(migrateUserData(from, to)).toEqual([]);
    expect(readFileSync(join(to, 'workspace.json'), 'utf8')).toBe('{"version":2}');
    expect(migrateUserData(join(dir, 'nothing'), join(dir, 'other'))).toEqual([]);
  });
});
