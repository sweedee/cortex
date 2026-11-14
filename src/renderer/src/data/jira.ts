/** Jira (`native.jira.*`, the mock CLI or acli): issues, searches, and the write ops. */
import { useQuery } from '@tanstack/react-query';
import type { IntegrationConfig } from '../../../shared/integrations/config';
import { jiraBrowseUrl, summarizeIssue, type JiraIssue } from '../../../shared/integrations/jira';
import type { JiraCreateIssueRequest, JiraEditIssueRequest } from '../../../shared/ipc';
import { native } from '../native';
import { invalidate, ready } from './ops';
import { queryClient } from './queryClient';
import { qk } from './queryKeys';

/** Full issue (REST v3 shape: ADF description, comments, links, …). */
export function useJiraIssue(key: string | undefined) {
  return useQuery({ queryKey: qk.jira.issue(key ?? ''), queryFn: () => native.jira.view(key!), enabled: ready(key) });
}

/** The same query reduced to `JiraIssueSummary` (status, type, assignee, sprint, points). */
export function useJiraIssueSummary(key: string | undefined) {
  return useQuery({ queryKey: qk.jira.issue(key ?? ''), queryFn: () => native.jira.view(key!), enabled: ready(key), select: summarizeIssue });
}

export function useJiraSearch(jql: string | undefined, limit?: number) {
  return useQuery({ queryKey: qk.jira.search(jql ?? '', limit), queryFn: () => native.jira.search(jql!, { limit }), enabled: ready(jql) });
}

/**
 * Browse URL of an issue key: the cached issue's site (REST `self`), else the configured Jira site
 * (`integrations:config`, prefetched by `startSync`), else the mock's. The one place that builds Jira links.
 */
export function jiraUrl(key: string): string {
  const issue = queryClient.getQueryData<JiraIssue>(qk.jira.issue(key));
  const config = queryClient.getQueryData<IntegrationConfig>(qk.app.config());
  return jiraBrowseUrl(key, { issue, site: config?.jira.site });
}

/** Writes. Each invalidates the issue and every search. */
export const jiraOps = {
  async transition(key: string, status: string) {
    await native.jira.transition(key, status);
    await invalidate(qk.jira.issue(key), qk.jira.searches());
  },
  async create(req: JiraCreateIssueRequest) {
    const issue = await native.jira.create(req);
    await invalidate(qk.jira.searches());
    return issue;
  },
  async comment(key: string, body: string) {
    const c = await native.jira.comment(key, body);
    await invalidate(qk.jira.issue(key));
    return c;
  },
  async edit(req: JiraEditIssueRequest) {
    await native.jira.edit(req);
    await invalidate(qk.jira.issue(req.key), qk.jira.searches());
  },
};
