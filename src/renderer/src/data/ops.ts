/**
 * Shared plumbing for the data hooks: invalidation, "can this query run here", and
 * `useOp` to use a plain write function (the `<service>Ops` objects) as a mutation in a component.
 *
 * Writes are plain async functions first (kind actions run outside React), each invalidating
 * the keys it changes; `useOp(gitOps.fetch)` gives a component `isPending` / `error` for one.
 */
import { useMutation, type QueryKey } from '@tanstack/react-query';
import { isDesktop } from '../native';
import { queryClient } from './queryClient';

/** Invalidate (and refetch the active of) every query under these keys. */
export const invalidate = (...keys: QueryKey[]) => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);

/** A query may run: in the desktop app, with every param present. */
export const ready = (...params: unknown[]) => isDesktop && params.every((p) => p != null && p !== '' && p !== 0);

/** A write op as a TanStack mutation: `const m = useOp(ghOps.prMerge); m.mutate([repo, n, 'squash'])`. */
export function useOp<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return useMutation<R, Error, A>({ mutationFn: (args: A) => fn(...args) });
}

/** "Every 15 s while something runs", for `refetchInterval`. */
export const pollWhile = (running: boolean, ms = 15_000) => (running ? ms : false);
