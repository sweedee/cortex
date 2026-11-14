import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../shared/integrations/config';
import { adfToMarkdown, browseUrl, summarizeIssue } from '../../shared/integrations/jira';
import { runExec } from '../lib/exec';
import { jiraCliSpec } from './config';
import { JiraService } from './jira';

const appRoot = process.cwd();
let dir: string;
let jira: JiraService;
let db: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-jira-'));
  db = join(dir, 'jira.json');
  const spec = jiraCliSpec(DEFAULT_CONFIG, { appRoot, userData: dir }, { JIRA_MOCK_DB: db });
  jira = new JiraService(spec, { cwd: dir });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** run the script directly to check exit codes / stderr like a CLI */
const cli = (...args: string[]) => runExec({ cmd: process.execPath, args: [join(appRoot, 'scripts/jira-mock/jira-mock.mjs'), ...args], cwd: dir, env: { JIRA_MOCK_DB: db } });

describe('jira-mock + JiraService', () => {
  it('seeds on first use and searches with simple JQL', async () => {
    const mine = await jira.search('assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC');
    expect(mine.map((i) => i.key).sort()).toEqual(['CTX-4790', 'CTX-4821', 'CTX-4833', 'CTX-4840']);
    expect((await jira.search('key in (CTX-4821, "CTX-4790")')).map((i) => i.key).sort()).toEqual(['CTX-4790', 'CTX-4821']);
    expect((await jira.search('project = CTX AND status = "In Review"')).map((i) => i.key)).toEqual(['CTX-4790']);
    expect((await jira.search('status in ("To Do", Blocked) AND assignee is EMPTY')).map((i) => i.key)).toEqual(['CTX-4802']);
    expect((await jira.search('summary ~ "backoff"')).map((i) => i.key)).toEqual(['CTX-4821']);
    expect((await jira.search('labels = alerting AND type = Bug')).map((i) => i.key)).toEqual(['CTX-4802']);
    expect((await jira.search('sprint in openSprints() AND priority = High')).map((i) => i.key).sort()).toEqual(['CTX-4821', 'CTX-4833']);
    expect(await jira.search('project = CTX', { limit: 2 })).toHaveLength(2);
  });

  it('prints Jira Cloud REST v3 issue JSON', async () => {
    const i = await jira.view('CTX-4821');
    expect(i.self).toBe(`https://example.atlassian.net/rest/api/3/issue/${i.id}`);
    expect(browseUrl(i)).toBe('https://example.atlassian.net/browse/CTX-4821');
    expect(i.fields.status).toMatchObject({ name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } });
    expect(i.fields.issuetype.name).toBe('Story');
    expect(i.fields.priority?.name).toBe('High');
    expect(i.fields.assignee?.displayName).toBe('You');
    expect(i.fields.parent?.key).toBe('CTX-4700');
    expect(i.fields.issuelinks?.[0]).toMatchObject({ type: { name: 'Blocks', outward: 'blocks' }, outwardIssue: { key: 'CTX-4833' } });
    expect(i.fields.description).toMatchObject({ type: 'doc', version: 1 });
    expect(adfToMarkdown(i.fields.description)).toContain('- gives up after 8 attempts');
    expect(i.fields.comment?.comments[0].author.displayName).toBe('Mara Lindqvist');
    expect(summarizeIssue(i)).toMatchObject({ key: 'CTX-4821', statusCategory: 'indeterminate', storyPoints: 5, sprint: 'CTX 26.23', epic: { key: 'CTX-4700' } });
    const few = await jira.view('CTX-4821', { fields: ['summary', 'status'] });
    expect(Object.keys(few.fields)).toEqual(['summary', 'status']);
  });

  it('validates transitions against the workflow', async () => {
    await expect(jira.transition('CTX-4840', 'Done')).rejects.toThrow(/^jira transition CTX-4840: transition to "Done" is not available/);
    await expect(jira.transition('CTX-4840', 'Done')).rejects.toThrow(/not available for CTX-4840 \(status "To Do"\)\. Available: In Progress, Blocked/);
    await jira.transition('CTX-4840', 'in progress');
    expect((await jira.view('CTX-4840')).fields.status.name).toBe('In Progress');
    await jira.transition('CTX-4840', 'In Review');
    await jira.transition('CTX-4840', 'Done');
    expect((await jira.view('CTX-4840')).fields.status.statusCategory.key).toBe('done');
    await expect(jira.transition('CTX-4840', 'Nope')).rejects.toThrow(/does not exist/);
  });

  it('creates, comments and edits', async () => {
    const created = await jira.create({ project: 'CTX', type: 'story', summary: 'Brand new', description: 'Line one\n\n- a\n- b', assignee: '@me', parent: 'CTX-4700' });
    expect(created.key).toBe('CTX-4841');
    expect(created.fields).toMatchObject({ summary: 'Brand new', status: { name: 'To Do' }, issuetype: { name: 'Story' }, assignee: { displayName: 'You' }, parent: { key: 'CTX-4700' } });
    const c = await jira.comment('CTX-4841', 'Looks good');
    expect(c).toMatchObject({ author: { displayName: 'You' }, body: { type: 'doc' } });
    await jira.edit({ key: 'CTX-4841', summary: 'Renamed', labels: ['x', 'y'] });
    const v = await jira.view('CTX-4841');
    expect(v.fields).toMatchObject({ summary: 'Renamed', labels: ['x', 'y'] });
    expect(v.fields.comment?.total).toBe(1);
    expect(adfToMarkdown(v.fields.description)).toBe('Line one\n\n- a\n- b');
  });

  it('behaves like a CLI: exit codes and stderr', async () => {
    const missing = await cli('jira', 'workitem', 'view', 'CTX-1', '--json');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/Issue does not exist/);
    expect(missing.stdout).toBe('');
    const usage = await cli('frobnicate');
    expect(usage.code).toBe(2);
    expect(usage.stderr).toMatch(/unknown command "frobnicate"/);
    const badJql = await cli('search', '--jql', 'colour = red');
    expect(badJql.code).toBe(1);
    expect(badJql.stderr).toMatch(/Field 'colour' does not exist/);
    const or = await cli('search', '--jql', 'project = CTX OR project = X');
    expect(or.code).toBe(1);
    const text = await cli('search', '--jql', 'key = CTX-4790');
    expect(text.stdout).toMatch(/^CTX-4790\tBug\tIn Review\tDashboard tiles flicker/);
    expect((await cli('--help')).code).toBe(0);
  });
});
