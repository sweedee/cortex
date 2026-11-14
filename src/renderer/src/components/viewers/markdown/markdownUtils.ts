/** Pure helpers for the Markdown viewer (kept free of React so they are unit-testable). */

export type Segment = { kind: 'md' | 'mermaid'; text: string; /** 0-based line of the segment in the source */ line: number };

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

function closesFence(line: string, fence: string): boolean {
  const t = line.trim();
  return t.length >= fence.length && t.split(fence[0]).join('') === '';
}

/**
 * Split markdown on closed ```mermaid fences. An unterminated trailing fence (still streaming)
 * stays in the markdown text, so it shows as a plain code block until it is closed.
 */
export function splitMermaid(src: string): Segment[] {
  const lines = src.split('\n');
  const out: Segment[] = [];
  let buf: string[] = [];
  let bufStart = 0;
  const flush = () => {
    if (buf.length) out.push({ kind: 'md', text: buf.join('\n'), line: bufStart });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]);
    if (!m) {
      if (!buf.length) bufStart = i;
      buf.push(lines[i]);
      continue;
    }
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (closesFence(lines[j], m[1])) {
        end = j;
        break;
      }
    }
    if (end < 0) {
      if (!buf.length) bufStart = i;
      buf.push(...lines.slice(i));
      break;
    }
    if (m[2].toLowerCase() === 'mermaid') {
      flush();
      out.push({ kind: 'mermaid', text: lines.slice(i + 1, end).join('\n'), line: i });
    } else {
      if (!buf.length) bufStart = i;
      buf.push(...lines.slice(i, end + 1));
    }
    i = end;
  }
  flush();
  return out;
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/;

/** 0-based line numbers of GFM task-list items (`- [ ] x`), in document order, skipping code fences. */
export function findTaskLines(src: string): number[] {
  const lines = src.split('\n');
  const found: number[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      if (closesFence(lines[i], fence)) fence = null;
      continue;
    }
    const open = OPEN.exec(lines[i]);
    if (open) {
      fence = open[1];
      continue;
    }
    if (TASK.test(lines[i])) found.push(i);
  }
  return found;
}

/** Return `src` with the `index`-th task item (document order) checked/unchecked; unchanged if out of range. */
export function toggleTask(src: string, index: number, checked: boolean): string {
  const lineNo = findTaskLines(src)[index];
  if (lineNo === undefined) return src;
  const lines = src.split('\n');
  lines[lineNo] = lines[lineNo].replace(TASK, `$1${checked ? 'x' : ' '}$3`);
  return lines.join('\n');
}

/** Map a task item's 0-based source line to its index, or -1. */
export function taskIndexForLine(taskLines: number[], line: number): number {
  return taskLines.indexOf(line);
}
