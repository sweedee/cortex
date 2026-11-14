import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRequest } from '../lib/validate';
import { jiraCliSpec, resolveConfig } from './config';
import { createServices } from '.';

describe('integration config', () => {
  it('reads env overrides', () => {
    const c = resolveConfig({ CORTEX_JIRA_CLI: 'acli', CORTEX_AI_REVIEW_COMMENT: '/review', CORTEX_CLAUDE_BIN: 'C:/bin/claude.exe' });
    expect(c.jira.cli).toBe('acli');
    expect(c.github.aiReviewComment).toBe('/review');
    expect(c.claude.bin).toBe('C:/bin/claude.exe');
    expect(resolveConfig({}).github.aiReviewComment).toBe('@claude review');
  });

  it('resolves the Jira CLI: mock via node (Electron as node), or acli', () => {
    const paths = { appRoot: 'C:/app', userData: 'C:/ud', nodeBin: 'C:/electron.exe', isElectron: true };
    expect(resolveConfig({}).jira).toMatchObject({ cli: 'acli', site: '' });
    expect(resolveConfig({ CORTEX_SMOKE: '1' }).jira.cli).toBe('mock');
    expect(resolveConfig({ CORTEX_SMOKE: '1', CORTEX_JIRA_CLI: 'acli' }).jira).toMatchObject({ cli: 'acli', explicit: true });
    expect(resolveConfig({ CORTEX_JIRA_SITE: 'https://acme.atlassian.net' }).jira.site).toBe('https://acme.atlassian.net');
    expect(jiraCliSpec(resolveConfig({}), paths, {})).toEqual({ command: 'acli', prefix: [], env: {} });
    expect(jiraCliSpec(resolveConfig({ CORTEX_JIRA_CLI: 'mock' }), paths, {})).toEqual({
      command: 'C:/electron.exe',
      prefix: [join('C:/app', 'scripts', 'jira-mock', 'jira-mock.mjs')],
      env: { ELECTRON_RUN_AS_NODE: '1', JIRA_MOCK_DB: join('C:/ud', 'jira-mock.json'), JIRA_MOCK_SITE: 'https://example.atlassian.net' },
    });
    expect(jiraCliSpec(resolveConfig({ CORTEX_JIRA_CLI: 'acli' }), paths, {})).toEqual({ command: 'acli', prefix: [], env: {} });
  });

  it('maps exec:run jira-mock to the resolved command', () => {
    const s = createServices({ appRoot: 'C:/app', userData: 'C:/ud', isElectron: false }, () => {}, { CORTEX_JIRA_CLI: 'mock' });
    const r = s.resolveExec({ cmd: 'jira-mock', args: ['jira', 'workitem', 'view', 'CTX-1'], cwd: 'C:/x', env: { A: '1' } });
    expect(r.cmd).toBe(process.execPath);
    expect(r.args).toEqual([join('C:/app', 'scripts', 'jira-mock', 'jira-mock.mjs'), 'jira', 'workitem', 'view', 'CTX-1']);
    expect(r.env).toMatchObject({ A: '1', JIRA_MOCK_DB: expect.stringContaining('jira-mock.json') });
    expect(s.resolveExec({ cmd: 'git', args: ['status'], cwd: 'C:/x' })).toEqual({ cmd: 'git', args: ['status'], cwd: 'C:/x' });
  });

  it('falls back to the mock when acli cannot be started (unless chosen explicitly)', async () => {
    const missing = () => Promise.reject(new Error('Could not run acli: spawn acli ENOENT'));
    const s = createServices({ appRoot: 'C:/app', userData: 'C:/ud', isElectron: false }, () => {}, {});
    s.jira.site = missing;
    await s.initJira();
    expect(s.config.jira).toMatchObject({ cli: 'mock', site: 'https://example.atlassian.net', note: expect.stringMatching(/acli not found/) });
    expect(s.jira.command).toBe(process.execPath);

    const e = createServices({ appRoot: 'C:/app', userData: 'C:/ud', isElectron: false }, () => {}, { CORTEX_JIRA_CLI: 'acli' });
    e.jira.site = missing;
    await e.initJira();
    expect(e.config.jira).toMatchObject({ cli: 'acli', note: expect.stringMatching(/could not be started/) });

    const ok = createServices({ appRoot: 'C:/app', userData: 'C:/ud', isElectron: false }, () => {}, {});
    ok.jira.site = () => Promise.resolve('https://acme.atlassian.net');
    await ok.initJira();
    expect(ok.config.jira).toMatchObject({ cli: 'acli', site: 'https://acme.atlassian.net' });
    expect(ok.config.jira.note).toBeUndefined();
  });
});

describe('integration request schemas', () => {
  it('accepts good requests', () => {
    expect(parseRequest('git:rebase', { dir: 'C:/wt', onto: 'origin/main' })).toEqual({ dir: 'C:/wt', onto: 'origin/main' });
    expect(parseRequest('gh:prMerge', { repo: 'o/r', number: 1, method: 'squash' })).toMatchObject({ method: 'squash' });
    expect(parseRequest('claude:permission', { localId: 'x', requestId: 'r', decision: { behavior: 'deny' } })).toBeTruthy();
    expect(parseRequest('integrations:config', undefined)).toBeUndefined();
  });

  it('rejects option injection and malformed input', () => {
    expect(() => parseRequest('git:rebase', { dir: 'C:/wt', onto: '--exec=calc' })).toThrow(/must not start with "-"/);
    expect(() => parseRequest('git:status', { dir: 'relative/path' })).toThrow(/absolute/);
    expect(() => parseRequest('gh:prView', { repo: 'not a repo', number: 1 })).toThrow(/owner\/name/);
    expect(() => parseRequest('gh:prMerge', { repo: 'o/r', number: 1, method: 'fast-forward' })).toThrow(/method/);
    expect(() => parseRequest('jira:view', { key: 'CTX 1' })).toThrow(/issue key/);
    expect(() => parseRequest('claude:start', { cwd: 'C:/x', permissionMode: 'yolo' })).toThrow(/permissionMode/);
  });
});
