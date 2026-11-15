/** Background refresh of a ticket (`KindModule.sync`): `jira view` (status, category, assignee, sprint, points, title). */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { DEMO_REPO, type Item, type ItemOf } from '../../domain';
import { native } from '../../native';
import { itemById, patchData } from '../../store';
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

/** Tickets of the demo world (their project is on the demo repo) are static: Jira has no such issue. */
export const isDemoTicket = (t: ItemOf<'ticket'>, project: Item | undefined) => project?.kind === 'project' && project.data.repo === DEMO_REPO && !!t.projectId;

export const ticketSync = (t: ItemOf<'ticket'>): SyncJob[] =>
  t.data.key && !isDemoTicket(t, t.projectId ? itemById(t.projectId) : undefined) ? [{ id: t.id, group: 'jira', fast: false, run: () => refreshTicket(t.id) }] : [];
