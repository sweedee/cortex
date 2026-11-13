import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceFile } from './workspaceFile';

let dir: string;
let ws: WorkspaceFile;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cortex-ws-'));
  ws = new WorkspaceFile(join(dir, 'workspace.json'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('WorkspaceFile', () => {
  it('loads null when nothing was saved', async () => {
    expect(await ws.load()).toBeNull();
  });

  it('round-trips JSON and keeps the previous version as .bak', async () => {
    await ws.save({ version: 0, items: [{ id: 'a' }] });
    expect(await ws.load()).toEqual({ version: 0, items: [{ id: 'a' }] });
    await ws.save({ version: 0, items: [{ id: 'b' }] });
    expect(await ws.load()).toEqual({ version: 0, items: [{ id: 'b' }] });
    expect(JSON.parse(await readFile(ws.backup, 'utf8'))).toEqual({ version: 0, items: [{ id: 'a' }] });
  });

  it('serializes bursts of saves; the last one wins and no temp files are left', async () => {
    const saves = Array.from({ length: 25 }, (_, i) => ws.save({ n: i }));
    await Promise.all(saves);
    await ws.flush();
    expect(await ws.load()).toEqual({ n: 24 });
    expect((await readdir(dir)).sort()).toEqual(['workspace.json', 'workspace.json.bak']);
  });

  it('falls back to the .bak when the main file is corrupt', async () => {
    await ws.save({ good: 1 });
    await ws.save({ good: 2 });
    await writeFile(ws.file, '{ truncated', 'utf8');
    expect(await ws.load()).toEqual({ good: 1 });
  });
});
