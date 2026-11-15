/** Test runner (`native.tests.*`): the user's test command. State arrives via `test:state` (see `sync/live.ts`). */
import { useQuery } from '@tanstack/react-query';
import type { TestRunRequest } from '../../../shared/integrations/runners';
import { native } from '../native';
import { invalidate, ready } from './ops';
import { qk } from './queryKeys';

/** Output of a run; `sync/live.ts` appends live `test:output` chunks to this cache. */
export function useTestLog(id: string | undefined) {
  return useQuery({ queryKey: qk.tests.log(id ?? ''), queryFn: () => native.tests.log({ id: id! }), enabled: ready(id), staleTime: Infinity });
}

/** Writes. Use the item id as the runner id (`testrun.data.procId = item.id`). */
export const testOps = {
  async run(req: TestRunRequest) {
    const s = await native.tests.run(req);
    await invalidate(qk.tests.list(), qk.tests.log(req.id));
    return s;
  },
  stop: (id: string) => native.tests.stop({ id }),
};
