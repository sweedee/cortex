/**
 * Coalesces chatty process output: chunks per (id, stream) are buffered and flushed at most
 * every `intervalMs` as one event. `flush(id)` drains one id right away (call it before the
 * exit event so output never arrives after the exit).
 */
export type Stream = 'stdout' | 'stderr';

export class OutputBatcher {
  private buf = new Map<string, { id: string; stream: Stream; chunks: string[] }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private emit: (id: string, stream: Stream, chunk: string) => void;
  private intervalMs: number;

  constructor(emit: (id: string, stream: Stream, chunk: string) => void, intervalMs = 100) {
    this.emit = emit;
    this.intervalMs = intervalMs;
  }

  push(id: string, stream: Stream, chunk: string): void {
    const key = `${stream}\0${id}`;
    const b = this.buf.get(key);
    if (b) b.chunks.push(chunk);
    else this.buf.set(key, { id, stream, chunks: [chunk] });
    this.timer ??= setTimeout(() => this.flushAll(), this.intervalMs);
  }

  flush(id: string): void {
    for (const [key, b] of this.buf) {
      if (b.id !== id) continue;
      this.buf.delete(key);
      this.emit(b.id, b.stream, b.chunks.join(''));
    }
  }

  flushAll(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const all = [...this.buf.values()];
    this.buf.clear();
    for (const b of all) this.emit(b.id, b.stream, b.chunks.join(''));
  }
}

/** Keeps the last `max` characters of a growing log. */
export class LogTail {
  private parts: string[] = [];
  private size = 0;
  private max: number;
  constructor(max = 256 * 1024) {
    this.max = max;
  }
  push(s: string) {
    this.parts.push(s);
    this.size += s.length;
    while (this.size > this.max) {
      const over = this.size - this.max;
      const first = this.parts[0];
      if (first.length <= over) {
        this.parts.shift();
        this.size -= first.length;
      } else {
        this.parts[0] = first.slice(over);
        this.size = this.max;
      }
    }
  }
  text() {
    return this.parts.join('');
  }
}
