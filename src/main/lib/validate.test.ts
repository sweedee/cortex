import { describe, expect, it } from 'vitest';
import { parseRequest } from './validate';

const cwd = process.platform === 'win32' ? 'C:\\repo' : '/repo';

describe('exec:run validation', () => {
  it('accepts every allowlisted command', () => {
    for (const cmd of ['git', 'gh', 'claude', 'node', 'jira-mock']) {
      expect(parseRequest('exec:run', { cmd, args: ['--version'], cwd }).cmd).toBe(cmd);
    }
  });

  it('rejects commands outside the allowlist, paths and shell tricks', () => {
    for (const cmd of ['rm', 'cmd', 'powershell', 'bash', 'git.exe', '/usr/bin/git', 'C:\\git\\git.exe', 'git; rm -rf /', 'npm']) {
      expect(() => parseRequest('exec:run', { cmd, args: [], cwd }), cmd).toThrow(/Invalid exec:run request/);
    }
  });

  it('requires an absolute cwd and string args', () => {
    expect(() => parseRequest('exec:run', { cmd: 'git', args: [], cwd: 'relative/dir' })).toThrow(/absolute/);
    expect(() => parseRequest('exec:run', { cmd: 'git', args: [1], cwd })).toThrow(/args/);
    expect(() => parseRequest('exec:run', { cmd: 'git', args: ['a\0b'], cwd })).toThrow(/NUL/);
    expect(() => parseRequest('exec:run', { cmd: 'git', args: [], cwd, timeoutMs: -1 })).toThrow(/timeoutMs/);
  });

  it('accepts UNC and POSIX absolute paths', () => {
    expect(parseRequest('exec:run', { cmd: 'git', args: [], cwd: '\\\\server\\share' }).cwd).toBe('\\\\server\\share');
    expect(parseRequest('exec:run', { cmd: 'git', args: [], cwd: '/home/me' }).cwd).toBe('/home/me');
  });
});

describe('other channels', () => {
  it('shell:openExternal only takes http(s)', () => {
    expect(parseRequest('shell:openExternal', { url: 'https://github.com' }).url).toBe('https://github.com');
    for (const url of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'ms-settings:', 'not a url']) {
      expect(() => parseRequest('shell:openExternal', { url }), url).toThrow(/Invalid shell:openExternal/);
    }
  });

  it('channels without payload accept undefined only', () => {
    expect(parseRequest('proc:list', undefined)).toBeUndefined();
    expect(() => parseRequest('app:info', { evil: true })).toThrow(/Invalid app:info/);
  });
});
