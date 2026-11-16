import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatArg, RotatingLog } from './log';

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'cortex-log-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('RotatingLog', () => {
  it('appends lines', async () => {
    const l = new RotatingLog(join(dir, 'main.log'), 1000, 2);
    l.write('a');
    l.write('b\n');
    expect(await readFile(l.file, 'utf8')).toBe('a\nb\n');
  });

  it('rotates by size and keeps only N old files', async () => {
    const l = new RotatingLog(join(dir, 'main.log'), 20, 2);
    for (let i = 0; i < 10; i++) l.write(`line-${i}-xxxxxxxx`); // 16 bytes each: one per file
    expect((await readdir(dir)).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    expect(await readFile(l.file, 'utf8')).toBe('line-9-xxxxxxxx\n');
    expect(await readFile(l.rotated(1), 'utf8')).toBe('line-8-xxxxxxxx\n');
    expect(await readFile(l.rotated(2), 'utf8')).toBe('line-7-xxxxxxxx\n');
  });

  it('continues the size count of an existing file', async () => {
    const f = join(dir, 'main.log');
    new RotatingLog(f, 20, 1).write('0123456789012345');
    const l = new RotatingLog(f, 20, 1);
    l.write('next');
    expect(await readFile(l.rotated(1), 'utf8')).toBe('0123456789012345\n');
  });

  it('formats errors with their stack', () => {
    expect(formatArg(new Error('boom'))).toContain('boom');
    expect(formatArg({ a: 1 })).toBe('{"a":1}');
  });
});
