import type { ItemOf, Segment } from '../../domain';

export function agentRing({ data }: ItemOf<'agent'>): Segment[] {
  const act = data.lastActivity;
  switch (data.status) {
    case 'running':
      return [{ tone: 'running', label: act ? `Running · ${act}` : 'Running' }];
    case 'waiting':
      return [{ tone: 'warning', label: data.pendingQuestion ? 'Waiting for your answer' : data.pendingPermissions?.length ? 'Waiting for your permission' : 'Waiting for you' }];
    case 'idle':
      return [{ tone: 'neutral', label: act ?? 'Idle' }];
    case 'done':
      return [{ tone: 'success', label: act ? `Done · ${act}` : 'Done' }];
    case 'failed':
      return [{ tone: 'critical', label: act ? `Failed · ${act}` : 'Failed' }];
  }
}
