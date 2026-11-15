/**
 * JiraService against output captured from the real Atlassian CLI (acli 1.3.40, site with German
 * locale, company-managed Kanban project CTX). Fixtures: `__fixtures__/acli/` (email scrubbed).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adfToMarkdown, browseUrl, jiraBrowseUrl, parseAcliSite, summarizeIssue, workflowStatuses, type JiraIssue } from '../../shared/integrations/jira';
import type { ExecResult } from '../../shared/ipc';
import type { Runner } from './cli';
import { JiraService } from './jira';

const fx = (name: string) => readFileSync(join(__dirname, '__fixtures__', 'acli', name), 'utf8');

/** A runner that answers with a fixture and records the argv. */
function replay(name: string, code = 0) {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code, stdout: fx(name), stderr: '', timedOut: false } satisfies ExecResult;
  };
  return { jira: new JiraService({ command: 'acli', prefix: [], env: {} }, { run, cwd: '.' }), calls };
}

describe('JiraService with real acli output', () => {
  it('views an issue (REST v3, localized status, gateway self URL)', async () => {
    const { jira, calls } = replay('view-CTX-6.json');
    const issue = await jira.view('CTX-6');
    expect(calls[0]).toEqual(['acli', 'jira', 'workitem', 'view', 'CTX-6', '--json', '--fields', '*all']);
    const s = summarizeIssue(issue);
    expect(s).toMatchObject({ key: 'CTX-6', type: 'Bug', status: 'In Arbeit', statusCategory: 'indeterminate', priority: 'Medium', labels: ['api'], epic: { key: 'CTX-1', summary: 'Todo app MVP' } });
    expect(s.assignee).toBeTruthy();
    expect(s.updated).toMatch(/^2026-/);
    // self is the API gateway, not the site: no browse URL from it, the site comes from `auth status`
    expect(issue.self).toMatch(/atl-paas\.net/);
    expect(s.url).toBe('');
    expect(browseUrl(issue)).toBe('');
    expect(jiraBrowseUrl('CTX-6', { issue, site: 'https://sweedee.atlassian.net' })).toBe('https://sweedee.atlassian.net/browse/CTX-6');
    expect(adfToMarkdown(issue.fields.description)).toContain('Steps to reproduce');
    expect(issue.fields.comment?.comments.map((c) => adfToMarkdown(c.body))).toEqual([
      'Reproduced on main, also happens with a missing title field.',
      'Fix rejects "" but the whitespace case still slips through - CI is red on the PR.',
    ]);
  });

  it('searches (array, default fields only: no updated / parent)', async () => {
    const { jira, calls } = replay('search.json');
    const found = await jira.search('project = CTX', { limit: 5 });
    expect(calls[0]).toEqual(['acli', 'jira', 'workitem', 'search', '--jql', 'project = CTX', '--json', '--limit', '5']);
    expect(found.map((i) => i.key).sort()).toEqual(['CTX-10', 'CTX-4', 'CTX-6']);
    const s = summarizeIssue(found[0]!);
    expect(s.updated).toBe('');
    expect(s.status).toBeTruthy();
  });

  it('derives the workflow from the statuses in use (localized names)', async () => {
    const { jira, calls } = replay('search-status.json');
    const st = await jira.statuses('CTX');
    expect(calls[0]).toEqual(['acli', 'jira', 'workitem', 'search', '--jql', 'project = "CTX"', '--json', '--paginate', '--fields', 'key,status']);
    expect(st.map((s) => s.category)).toEqual(['new', 'new', 'indeterminate', 'done']);
    expect(st.map((s) => s.name).sort()).toEqual(['Backlog', 'Fertig', 'In Arbeit', 'Selected for Development']);
    expect(workflowStatuses(JSON.parse(fx('search-status.json')) as JiraIssue[])).toEqual(st);
  });

  it('transitions: success, and FAILURE results although acli exits 0', async () => {
    const ok = replay('transition-success.json');
    await ok.jira.transition('CTX-6', 'In Arbeit');
    expect(ok.calls[0]).toEqual(['acli', 'jira', 'workitem', 'transition', '--key', 'CTX-6', '--status', 'In Arbeit', '--yes', '--json']);
    await expect(replay('transition-failure.json').jira.transition('CTX-6', 'Done')).rejects.toThrow('jira transition: CTX-6: No allowed transitions found for given status');
  });

  it('comments (bulk result → null) and edits (failure → throws)', async () => {
    expect(await replay('comment-create.json').jira.comment('CTX-13', 'hi')).toBeNull();
    await expect(replay('edit-failure.json').jira.edit({ key: 'CTX-999', summary: 'x' })).rejects.toThrow(/CTX-999: /);
  });

  it('reads the site from auth status', async () => {
    expect(await replay('auth-status.txt').jira.site()).toBe('https://sweedee.atlassian.net');
    expect(parseAcliSite('✗ Not authenticated')).toBeNull();
    expect(parseAcliSite('  Site: https://x.atlassian.net/\n')).toBe('https://x.atlassian.net');
  });

  it('turns a plain ✗ line into an error', async () => {
    const run: Runner = async () => ({ code: 0, stdout: "✗ Failure: CTX-1 can't be transitioned: No allowed transitions found for given status\n", stderr: '', timedOut: false });
    const jira = new JiraService({ command: 'acli', prefix: [], env: {} }, { run, cwd: '.' });
    await expect(jira.transition('CTX-1', 'X')).rejects.toThrow("jira transition: CTX-1 can't be transitioned");
  });
});
