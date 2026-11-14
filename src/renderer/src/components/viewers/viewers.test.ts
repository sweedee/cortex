import { describe, expect, it } from 'vitest';
import { parse } from 'diff2html';
import { parseDiffStats } from './diff/diffStats';
import { findTaskLines, splitMermaid, toggleTask } from './markdown/markdownUtils';
import { tailLines } from './log/logUtils';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 import x from 'x';
-const a = 1;
+const a = 2;
+const b = 3;
 export { a };
diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# Hello
+World
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;

describe('parseDiffStats', () => {
  it('counts per file with statuses', () => {
    const s = parseDiffStats(DIFF);
    expect(s.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['src/a.ts', 'modified', 2, 1],
      ['README.md', 'added', 2, 0],
      ['gone.txt', 'deleted', 0, 1],
      ['new.txt', 'renamed', 0, 0],
      ['img.png', 'modified', 0, 0],
    ]);
    expect(s.files[3].oldPath).toBe('old.txt');
    expect(s.files[4].binary).toBe(true);
    expect([s.additions, s.deletions]).toEqual([4, 2]);
  });

  it('handles plain (non-git) multi-file diffs and empty input', () => {
    const plain = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/y\n+++ b/y\n@@ -1 +1,2 @@\n a\n+c\n';
    const s = parseDiffStats(plain);
    expect(s.files.map((f) => [f.path, f.additions, f.deletions])).toEqual([['x', 1, 1], ['y', 1, 0]]);
    expect(parseDiffStats('')).toEqual({ files: [], additions: 0, deletions: 0 });
  });

  it('agrees with diff2html on totals', () => {
    const ours = parseDiffStats(DIFF);
    const theirs = parse(DIFF);
    expect(theirs.reduce((n, f) => n + f.addedLines, 0)).toBe(ours.additions);
    expect(theirs.reduce((n, f) => n + f.deletedLines, 0)).toBe(ours.deletions);
  });
});

describe('markdown tasks', () => {
  const md = '- [ ] one\n- [x] two\n\n```\n- [ ] in code\n```\n\n1. [ ] three\n* [X] four';
  it('indexes tasks in document order, skipping code fences', () => {
    expect(findTaskLines(md)).toEqual([0, 1, 7, 8]);
  });
  it('toggles the nth task', () => {
    expect(toggleTask(md, 0, true).split('\n')[0]).toBe('- [x] one');
    expect(toggleTask(md, 1, false).split('\n')[1]).toBe('- [ ] two');
    expect(toggleTask(md, 2, true).split('\n')[7]).toBe('1. [x] three');
    expect(toggleTask(md, 3, false).split('\n')[8]).toBe('* [ ] four');
    expect(toggleTask(md, 9, true)).toBe(md);
    expect(toggleTask(md, 0, true)).toContain('- [ ] in code');
  });
});

describe('splitMermaid', () => {
  it('splits closed mermaid fences and records source lines', () => {
    const s = splitMermaid('a\n```mermaid\ngraph TD\n```\n- [ ] t\n');
    expect(s.map((x) => x.kind)).toEqual(['md', 'mermaid', 'md']);
    expect(s[2].line).toBe(4);
    expect(s[1].text).toBe('graph TD');
  });
  it('leaves an unterminated fence as markdown', () => {
    expect(splitMermaid('x\n```mermaid\ngraph').map((x) => x.kind)).toEqual(['md']);
  });
});

describe('tailLines', () => {
  it('caps and reports dropped lines', () => {
    expect(tailLines({ text: 'a\nb\nc\nd\n' }, 2)).toEqual({ lines: ['c', 'd'], dropped: 2 });
    expect(tailLines({ lines: ['a', 'b'] }, 5)).toEqual({ lines: ['a', 'b'], dropped: 0 });
  });
  it('keeps the last frame of carriage-return progress', () => {
    expect(tailLines({ lines: ['10%\r50%\r100%'] }, 5).lines).toEqual(['100%']);
  });
});
