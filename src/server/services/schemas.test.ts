import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError, parseJson } from './cli';
import { ghChecksSchema, ghPrListSchema, ghRunSchema, jiraIssueSchema, jiraSearchSchema } from './schemas';

const fx = (n: string) => readFileSync(join(__dirname, '__fixtures__', 'acli', n), 'utf8');

describe('acli fixtures match the schemas', () => {
  it('search and view', () => {
    expect(() => parseJson(fx('search.json'), 'jira search', jiraSearchSchema)).not.toThrow();
    expect(() => parseJson(fx('view-CTX-6.json'), 'jira view', jiraIssueSchema)).not.toThrow();
  });
  it('rejects an issue without a key', () => {
    expect(() => parseJson('{"fields":{}}', 'jira view', jiraIssueSchema)).toThrow(ParseError);
  });
});

describe('gh schemas', () => {
  const pr = { number: 1, title: 't', state: 'OPEN', url: 'u', headRefName: 'h', baseRefName: 'b', author: { login: 'x' }, labels: [], statusCheckRollup: [], newField: 1 };
  it('are lenient about extra and missing optional fields', () => {
    expect(() => parseJson(JSON.stringify([pr]), 'gh pr list', ghPrListSchema)).not.toThrow();
    expect(() => parseJson(JSON.stringify([{ name: 'build' }]), 'gh pr checks', ghChecksSchema)).not.toThrow();
    expect(() => parseJson(JSON.stringify({ databaseId: 1, status: 'queued' }), 'gh run view', ghRunSchema)).not.toThrow();
  });
  it('fail clearly on a changed shape', () => {
    expect(() => parseJson('{"message":"Not Found"}', 'gh pr list', ghPrListSchema)).toThrow(/gh pr list: unexpected output/);
    expect(() => parseJson(JSON.stringify([{ ...pr, number: 'one' }]), 'gh pr list', ghPrListSchema)).toThrow(/0\.number/);
    expect(() => parseJson('nope', 'gh pr list', ghPrListSchema)).toThrow(/expected JSON/);
  });
});
