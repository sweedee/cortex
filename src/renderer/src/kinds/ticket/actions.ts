/** Ticket operations: change status, mark done (Jira first), open in Jira, refresh the cached fields. */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { jiraOps, jiraUrl, loadJiraStatuses } from '../../data/jira';
import { itemById, patchData } from '../../store';
import type { ItemOf } from '../../domain';
import { native } from '../../native';
import { ticketPatch } from '../../sync/mapping';
import { openForm, str } from '../../ui/form';
import { errorText } from '../../ui/task';
import { archive, toast } from '../common';
import { doneStatus, projectOfKey, statusOptions, transitionToDone } from './model';

type Ticket = ItemOf<'ticket'>;

/** Browse URL of a ticket (see `jiraUrl` in data/jira.ts). */
export const ticketUrl = jiraUrl;

/** Re-read the issue and write status, assignee, sprint… (and the title) back to the bubble. */
export async function refreshTicket(id: string): Promise<void> {
  const cur = itemById(id);
  if (cur?.kind !== 'ticket') return;
  const issue = await native.jira.view({ key: cur.data.key });
  const { patch, title } = ticketPatch(issue);
  patchData<'ticket'>(id, patch, title ? { title } : {});
  queryClient.setQueryData(qk.jira.issue(cur.data.key), issue);
}

/**
 * "Change status…": a radio of the project's workflow statuses (as Jira reports them, localized names
 * included); Jira's rejection is shown inline in the form.
 */
export async function openChangeStatus(t: Ticket): Promise<void> {
  const current = t.data.status;
  const statuses = statusOptions(await loadJiraStatuses(projectOfKey(t.data.key)), { name: current, category: t.data.statusCategory });
  await openForm({
    title: `Change status of ${t.data.key}`,
    description: t.title,
    submitLabel: 'Change status',
    fields: [
      {
        name: 'status',
        label: 'Status',
        type: 'radio',
        required: true,
        options: statuses.map((s) => ({ value: s.name, label: s.name, hint: s.name.toLowerCase() === current.toLowerCase() ? 'current' : undefined })),
        hint: 'The statuses used in this Jira project. Jira only allows the moves its workflow defines.',
      },
    ],
    values: { status: statuses.find((s) => s.name.toLowerCase() === current.toLowerCase())?.name ?? current },
    onSubmit: async (v) => {
      const status = str(v, 'status');
      if (status.toLowerCase() === current.toLowerCase()) throw new Error(`${t.data.key} is already ${current}.`);
      await jiraOps.transition(t.data.key, status);
      let refreshError: string | undefined;
      await refreshTicket(t.id).catch((e: unknown) => {
        refreshError = errorText(e);
        patchData<'ticket'>(t.id, { status });
      });
      if (refreshError) toast(`${t.data.key} → ${status}`, `Changed in Jira, but the ticket could not be re-read (${refreshError}); showing the new status locally.`, 'warning');
      else toast(`${t.data.key} → ${status}`);
    },
  });
}

/**
 * "Mark done": transition to Done in Jira (stepping through the workflow if needed), then archive.
 * If Jira will not do it (or is unreachable) the bubble is still completed locally, with a warning.
 */
export async function completeTickets(items: Ticket[]): Promise<void> {
  const warnings: string[] = [];
  const doneName = new Map<string, string>();
  for (const t of items) {
    const statuses = statusOptions(await loadJiraStatuses(projectOfKey(t.data.key)), { name: t.data.status, category: t.data.statusCategory });
    doneName.set(t.id, doneStatus(statuses));
    if (t.data.statusCategory !== 'done') {
      const r = await transitionToDone(t.data.key, t.data.status, jiraOps.transition, statuses);
      if (!r.ok) warnings.push(`${t.data.key}: ${r.error}`);
    }
  }
  archive(items, 'Completed', (i) => patchData(i.id, { status: doneName.get(i.id) ?? 'Done', statusCategory: 'done' }));
  if (warnings.length) toast('Jira did not accept the transition', `${warnings.join(' · ')} — marked done on the canvas only.`, 'warning');
}
