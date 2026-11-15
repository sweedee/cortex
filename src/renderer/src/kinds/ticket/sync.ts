/** Background refresh of a ticket (`KindModule.sync`): `jira view` (status, category, assignee, sprint, points, title). */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import type { ItemOf } from '../../domain';
import { native } from '../../native';
import { patchData } from '../../store';
import { changes, ticketPatch } from '../../sync/mapping';
import { currentItem } from '../common';
import type { SyncJob } from '../types';

async function refreshTicket(id: string) {
  const t = currentItem(id, 'ticket');
  if (!t) return;
  const issue = await native.jira.view(t.data.key);
  queryClient.setQueryData(qk.jira.issue(t.data.key), issue);
  const cur = currentItem(id, 'ticket');
  if (!cur) return;
  const { patch, title } = ticketPatch(issue);
  if (changes(cur.data, patch) || (title && title !== cur.title)) patchData<'ticket'>(cur, patch, title ? { title } : {});
}

export const ticketSync = (t: ItemOf<'ticket'>): SyncJob[] => (t.data.key ? [{ id: t.id, group: 'jira', fast: false, run: () => refreshTicket(t.id) }] : []);
