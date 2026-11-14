/** Normalise `lines` | `text` input to the last `max` lines (CR-only progress rewrites keep the final frame). */
export function tailLines(input: { lines?: string[]; text?: string }, max: number): { lines: string[]; dropped: number } {
  const all = input.lines ?? (input.text ?? '').replace(/\r\n/g, '\n').split('\n');
  // drop the empty element a trailing newline produces
  if (!input.lines && all.length && all[all.length - 1] === '') all.pop();
  const dropped = Math.max(0, all.length - max);
  const kept = dropped ? all.slice(dropped) : all;
  // a bare \r rewrites the line (progress bars): show what the terminal would
  return { lines: kept.map((l) => (l.includes('\r') ? (l.split('\r').filter(Boolean).pop() ?? '') : l)), dropped };
}
