/**
 * The app's TanStack Query client: remote / live data (gh, git, jira, processes, files)
 * is read through query hooks in `src/data/`, never stored in the persisted items.
 * See docs/ARCHITECTURE.md → "Remote data".
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // CLI calls are local and cheap-ish, but don't hammer them on every focus change
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
