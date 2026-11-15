import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { sleep } from '../../shared/util';


/**
 * Write a file so readers only ever see the old or the new content: write a temp file in
 * the same directory, fsync it, then rename it over the target. On Windows the rename can
 * fail briefly with EPERM / EBUSY while a virus scanner or indexer holds the target open,
 * so it is retried a few times.
 */
export async function atomicWrite(file: string, text: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const h = await fs.open(tmp, 'w');
  try {
    await h.writeFile(text, 'utf8');
    await h.sync();
  } finally {
    await h.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await sleep(20 * (attempt + 1));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}
