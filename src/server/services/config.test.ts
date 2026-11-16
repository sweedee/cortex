import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRequest } from '../lib/validate';
import { parseUserConfig } from '../../shared/userConfig';
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

  it('resolves DEFAULT_CONFIG ← config.json ← env', () => {
    const user = parseUserConfig({
      claude: { bin: 'C:/tools/claude.exe' },
      github: { aiReviewComment: '/review please', aiReviewBot: 'reviewer[bot]', renovate: { app: 'dependabot', label: 'dependencies' } },
      jira: { site: 'https://acme.atlassian.net/' },
    });
    const fromFile = resolveConfig({}, user);
    expect(fromFile.claude.bin).toBe('C:/tools/claude.exe');
    expect(fromFile.github).toEqual({ aiReviewComment: '/review please', aiReviewBot: 'reviewer[bot]', renovateApp: 'dependabot', renovateLabel: 'dependencies' });
    expect(fromFile.jira).toMatchObject({ cli: 'acli', site: 'https://acme.atlassian.net' });
    // env (dev builds only: a packaged build strips these first, lib/devEnv.ts) wins over the file
    const env = resolveConfig({ CORTEX_AI_REVIEW_COMMENT: '/env', CORTEX_CLAUDE_BIN: '/env/claude', CORTEX_JIRA_SITE: 'https://env.atlassian.net', CORTEX_RENOVATE_APP: 'renovate-env' }, user);
    expect(env.github).toMatchObject({ aiReviewComment: '/env', aiReviewBot: 'reviewer[bot]', renovateApp: 'renovate-env' });
    expect(env.claude.bin).toBe('/env/claude');
    expect(env.jira.site).toBe('https://env.atlassian.net');
    // without either: the shared defaults
    expect(resolveConfig({}).github).toEqual({ aiReviewComment: '@claude review', aiReviewBot: 'claude[bot]', renovateApp: 'renovate', renovateLabel: 'renovate' });
  });

  it('jira.cli from config.json: mock is a deliberate choice; a fixed site survives the mock', () => {
    expect(resolveConfig({}, parseUserConfig({ jira: { cli: 'mock' } })).jira).toMatchObject({ cli: 'mock', explicit: true, site: 'https://example.atlassian.net' });
    expect(resolveConfig({ CORTEX_JIRA_CLI: 'acli' }, parseUserConfig({ jira: { cli: 'mock' } })).jira.cli).toBe('acli');
    expect(resolveConfig({ CORTEX_JIRA_CLI: 'mock' }, parseUserConfig({ jira: { site: 'https://acme.atlassian.net' } })).jira).toMatchObject({ cli: 'mock', site: 'https://acme.atlassian.net' });
  });

  it('applies config.json changes while running (GitHub settings)', () => {
    const s = createServices({ appRoot: 'C:/app', userData: 'C:/ud' }, () => {}, {});
    s.setUserConfig(parseUserConfig({ github: { aiReviewComment: '/now' } }));
    expect(s.config.github.aiReviewComment).toBe('/now');
  });

  it('resolves the Jira CLI: mock via node, or acli', () => {
    const paths = { appRoot: 'C:/app', userData: 'C:/ud', nodeBin: 'C:/node.exe' };
    expect(resolveConfig({}).jira).toMatchObject({ cli: 'acli', site: '' });
    expect(resolveConfig({ CORTEX_JIRA_CLI: 'mock' }).jira).toMatchObject({ cli: 'mock', explicit: true });
    expect(resolveConfig({ CORTEX_JIRA_CLI: 'acli' }).jira).toMatchObject({ cli: 'acli', explicit: true });
    expect(resolveConfig({ CORTEX_JIRA_SITE: 'https://acme.atlassian.net' }).jira.site).toBe('https://acme.atlassian.net');
    expect(jiraCliSpec(resolveConfig({}), paths, {})).toEqual({ command: 'acli', prefix: [], env: {} });
    expect(jiraCliSpec(resolveConfig({ CORTEX_JIRA_CLI: 'mock' }), paths, {})).toEqual({
      command: 'C:/node.exe',
      prefix: [join('C:/app', 'scripts', 'jira-mock', 'jira-mock.mjs')],
      env: { JIRA_MOCK_DB: join('C:/ud', 'jira-mock.json'), JIRA_MOCK_SITE: 'https://example.atlassian.net' },
    });
    expect(jiraCliSpec(resolveConfig({ CORTEX_JIRA_CLI: 'acli' }), paths, {})).toEqual({ command: 'acli', prefix: [], env: {} });
  });

  it('maps exec:run jira-mock to the resolved command', () => {
    const s = createServices({ appRoot: 'C:/app', userData: 'C:/ud' }, () => {}, { CORTEX_JIRA_CLI: 'mock' });
    const r = s.resolveExec({ cmd: 'jira-mock', args: ['jira', 'workitem', 'view', 'CTX-1'], cwd: 'C:/x', env: { A: '1' } });
    expect(r.cmd).toBe(process.execPath);
    expect(r.args).toEqual([join('C:/app', 'scripts', 'jira-mock', 'jira-mock.mjs'), 'jira', 'workitem', 'view', 'CTX-1']);
    expect(r.env).toMatchObject({ A: '1', JIRA_MOCK_DB: expect.stringContaining('jira-mock.json') });
    expect(s.resolveExec({ cmd: 'git', args: ['status'], cwd: 'C:/x' })).toEqual({ cmd: 'git', args: ['status'], cwd: 'C:/x' });
  });

  it('falls back to the mock when acli cannot be started (unless chosen explicitly)', async () => {
    const missing = () => Promise.reject(new Error('Could not run acli: spawn acli ENOENT'));
    const s = createServices({ appRoot: 'C:/app', userData: 'C:/ud' }, () => {}, {});
    s.jira.site = missing;
    await s.initJira();
    expect(s.config.jira).toMatchObject({ cli: 'mock', site: 'https://example.atlassian.net', note: expect.stringMatching(/acli not found/) });
    expect(s.jira.command).toBe(process.execPath);

    const e = createServices({ appRoot: 'C:/app', userData: 'C:/ud' }, () => {}, { CORTEX_JIRA_CLI: 'acli' });
    e.jira.site = missing;
    await e.initJira();
    expect(e.config.jira).toMatchObject({ cli: 'acli', note: expect.stringMatching(/could not be started/) });

    const ok = createServices({ appRoot: 'C:/app', userData: 'C:/ud' }, () => {}, {});
    ok.jira.site = () => Promise.resolve('https://acme.atlassian.net');
    await ok.initJira();
    expect(ok.config.jira).toMatchObject({ cli: 'acli', site: 'https://acme.atlassian.net' });
    expect(ok.config.jira.note).toBeUndefined();
  });

  it('a packaged build never falls back to the mock: Jira is marked unavailable', async () => {
    const p = createServices({ appRoot: 'C:/app', userData: 'C:/ud', production: true }, () => {}, {});
    p.jira.site = () => Promise.reject(new Error('spawn acli ENOENT'));
    await p.initJira();
    expect(p.config.jira).toMatchObject({ cli: 'acli', unavailable: true, note: expect.stringMatching(/Jira not configured.*acli jira auth login/) });
    expect(p.jira.command).toBe('acli');
    // and "mock" in config.json is still honoured on purpose
    const m = createServices({ appRoot: 'C:/app', userData: 'C:/ud', production: true }, () => {}, {}, parseUserConfig({ jira: { cli: 'mock' } }));
    await m.initJira();
    expect(m.config.jira).toMatchObject({ cli: 'mock' });
    expect(m.config.jira.unavailable).toBeUndefined();
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
