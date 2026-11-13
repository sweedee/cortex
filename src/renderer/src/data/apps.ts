/** App runner (`native.apps.*`): the user's start command. State arrives via `app:state` (see `sync/live.ts`). */
import { useQuery } from '@tanstack/react-query';
import type { AppStartRequest } from '../../../shared/integrations/runners';
import { native } from '../native';
import { invalidate, ready } from './ops';
import { qk } from './queryKeys';

export function useApps() {
  return useQuery({ queryKey: qk.apps.list(), queryFn: () => native.apps.list(), enabled: ready() });
}

/** Last 256 KB of output; `sync/live.ts` appends live `app:output` chunks to this cache. */
export function useAppLog(id: string | undefined) {
  return useQuery({ queryKey: qk.apps.log(id ?? ''), queryFn: () => native.apps.log(id!), enabled: ready(id), staleTime: Infinity });
}

/** Writes. Use the item id as the runner id (`app.data.procId = item.id`). */
export const appOps = {
  async start(req: AppStartRequest) {
    const s = await native.apps.start(req);
    await invalidate(qk.apps.list(), qk.apps.log(req.id));
    return s;
  },
  stop: (id: string) => native.apps.stop(id),
  async restart(id: string) {
    const s = await native.apps.restart(id);
    await invalidate(qk.apps.log(id));
    return s;
  },
  async remove(id: string) {
    const r = await native.apps.remove(id);
    await invalidate(qk.apps.list());
    return r;
  },
};
