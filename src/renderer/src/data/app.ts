/** Example query hook (the pattern for every integration): one hook per remote resource. */
import { useQuery } from '@tanstack/react-query';
import { native } from '../native';
import { qk } from './queryKeys';

/** Platform / version info of the running app (`app:info`). Never changes while running. */
export function useAppInfo() {
  return useQuery({ queryKey: qk.app.info(), queryFn: () => native.app.info(), staleTime: Infinity });
}
