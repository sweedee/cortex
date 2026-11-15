/** Unwrap a value a test knows is there (an array element, a map entry); a clear failure instead of `undefined` later. */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to exist`);
  return value;
}
