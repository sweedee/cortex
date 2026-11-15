import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, WorkspaceFile } from './workspaceFile';

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
    const [newest] = await ws.backups();
    expect(JSON.parse(await readFile(newest!, 'utf8'))).toEqual({ version: 0, items: [{ id: 'a' }] });
  });

  it('serializes bursts of saves; the last one wins and no temp files are left', async () => {
    const saves = Array.from({ length: 25 }, (_, i) => ws.save({ n: i }));
    await Promise.all(saves);
    await ws.flush();
    expect(await ws.load()).toEqual({ n: 24 });
    expect((await readdir(dir)).filter((n) => !/^workspace\.json(\.\d+\.bak)?$/.test(n))).toEqual([]);
  });

  it('falls back to the .bak when the main file is corrupt', async () => {
    await ws.save({ good: 1 });
    await ws.save({ good: 2 });
    await writeFile(ws.file, '{ truncated', 'utf8');
    expect(await ws.load()).toEqual({ good: 1 });
  });

  it('sets a corrupt file aside and a later save does not destroy the good backup', async () => {
    await ws.save({ good: 1 });
    await ws.save({ good: 2 });
    await writeFile(ws.file, '{ truncated', 'utf8');
    expect(await ws.load()).toEqual({ good: 1 });
    const names = await readdir(dir);
    expect(names.some((n) => /^workspace\.corrupt-\d+\.json$/.test(n))).toBe(true);
    expect(names).not.toContain('workspace.json');
    await ws.save({ good: 3 });
    await ws.save({ good: 4 });
    const all = await Promise.all((await ws.backups()).map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
    expect(all).toContainEqual({ good: 1 });
  });

  it('does not rotate a corrupt file into the backups on save', async () => {
    await ws.save({ good: 1 });
    await ws.save({ good: 2 });
    await writeFile(ws.file, '{ truncated', 'utf8');
    await ws.save({ good: 3 }); // without a load in between
    const all = await Promise.all((await ws.backups()).map((f) => readFile(f, 'utf8')));
    expect(all.every((t) => t.includes('good'))).toBe(true);
    expect((await readdir(dir)).some((n) => n.startsWith('workspace.corrupt-'))).toBe(true);
    expect(await ws.load()).toEqual({ good: 3 });
  });

  it('keeps only the newest backups', async () => {
    for (let i = 0; i < 10; i++) await ws.save({ n: i });
    const files = await ws.backups();
    expect(files).toHaveLength(BACKUPS_KEPT);
    expect(JSON.parse(await readFile(files[0]!, 'utf8'))).toEqual({ n: 8 });
    expect(JSON.parse(await readFile(files[files.length - 1]!, 'utf8'))).toEqual({ n: 4 });
  });

  it('reads a legacy .bak when nothing else is there', async () => {
    await writeFile(ws.backup, JSON.stringify({ legacy: true }), 'utf8');
    expect(await ws.load()).toEqual({ legacy: true });
  });
});
