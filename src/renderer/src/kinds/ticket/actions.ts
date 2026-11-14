/** Ticket operations: change status, mark done (Jira first), open in Jira, refresh the cached fields. */
import { queryClient } from '../../data/queryClient';
import { qk } from '../../data/queryKeys';
import { jiraOps } from '../../data/jira';
import { itemById, patchData } from '../../store';
import type { ItemOf } from '../../domain';
import { native } from '../../native';
import { ticketPatch } from '../../sync/mapping';
import { openForm, str } from '../../ui/form';
import { archive, toast } from '../common';
import type { IntegrationConfig } from '../../../../shared/integrations/config';
import type { JiraIssue } from '../../../../shared/integrations/jira';
import { JIRA_STATUSES } from '../../../../shared/integrations/jira';
import { jiraUrl, transitionToDone } from './model';

type Ticket = ItemOf<'ticket'>;

/** Browse URL: from the cached issue, else the configured Jira site, else the mock's. */
export function ticketUrl(key: string): string {
  const issue = queryClient.getQueryData<JiraIssue>(qk.jira.issue(key));
  const config = queryClient.getQueryData<IntegrationConfig>(qk.app.config());
  return jiraUrl(key, { issue, site: config?.jira.site });
}

/** Re-read the issue and write status, assignee, sprint… (and the title) back to the bubble. */
export async function refreshTicket(id: string): Promise<void> {
  const cur = itemById(id);
  if (cur?.kind !== 'ticket') return;
  const issue = await native.jira.view(cur.data.key);
  const { patch, title } = ticketPatch(issue);
  patchData<'ticket'>(id, patch, title ? { title } : {});
  queryClient.setQueryData(qk.jira.issue(cur.data.key), issue);
}

/** "Change status…": a radio of the workflow's statuses; Jira's rejection is shown inline in the form. */
export async function openChangeStatus(t: Ticket): Promise<void> {
  const current = t.data.status;
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
        options: JIRA_STATUSES.map((s) => ({ value: s, label: s, hint: s.toLowerCase() === current.toLowerCase() ? 'current' : undefined })),
        hint: 'Jira only allows some moves (e.g. To Do → In Progress → In Review → Done).',
      },
    ],
    values: { status: JIRA_STATUSES.find((s) => s.toLowerCase() === current.toLowerCase()) ?? current },
    onSubmit: async (v) => {
      const status = str(v, 'status');
      if (status.toLowerCase() === current.toLowerCase()) throw new Error(`${t.data.key} is already ${current}.`);
      await jiraOps.transition(t.data.key, status);
      await refreshTicket(t.id).catch(() => patchData<'ticket'>(t.id, { status }));
      toast(`${t.data.key} → ${status}`);
    },
  });
}

/**
 * "Mark done": transition to Done in Jira (stepping through the workflow if needed), then archive.
 * If Jira will not do it (or is unreachable) the bubble is still completed locally, with a warning.
 */
export async function completeTickets(items: Ticket[]): Promise<void> {
  const warnings: string[] = [];
  for (const t of items) {
    if (t.data.statusCategory !== 'done') {
      const r = await transitionToDone(t.data.key, t.data.status, jiraOps.transition);
      if (!r.ok) warnings.push(`${t.data.key}: ${r.error}`);
    }
  }
  archive(items, 'Completed', (i) => patchData(i.id, { status: 'Done', statusCategory: 'done' }));
  if (warnings.length) toast('Jira did not accept the transition', `${warnings.join(' · ')} — marked done on the canvas only.`, 'warning');
}
