import { describe, expect, it } from 'vitest';
import { baseName, dirOf, isAbsolutePath, isInsidePath, normPath, samePath, sepOf } from './paths';
import { ticketKeyOf } from './util';

describe('normPath', () => {
  it('ignores slash style and trailing slashes', () => {
    expect(normPath('C:\\a\\b\\')).toBe('c:/a/b');
    expect(normPath('/a/b//')).toBe('/a/b');
  });
  it('lower-cases Windows paths only (drive letter or UNC)', () => {
    expect(normPath('C:\\Work\\Repo')).toBe(normPath('c:/work/repo'));
    expect(normPath('\\\\Srv\\Share\\X')).toBe('//srv/share/x');
    expect(normPath('/a/B')).toBe('/a/B');
    expect(normPath('/a/B')).not.toBe(normPath('/a/b'));
  });
});

describe('path helpers', () => {
  it('samePath / isInsidePath', () => {
    expect(samePath('C:\\a\\b\\', 'c:/a/b')).toBe(true);
    expect(samePath('/a/b', '/a/B')).toBe(false);
    expect(isInsidePath('C:\\wt\\a\\src', 'c:/wt/a')).toBe(true);
    expect(isInsidePath('C:\\wt\\ab', 'c:/wt/a')).toBe(false);
    expect(isInsidePath('/wt/a', '/wt/a/')).toBe(true);
  });
  it('baseName / dirOf / sepOf', () => {
    expect(baseName('C:\\code\\app\\')).toBe('app');
    expect(baseName('a/b/plan.md')).toBe('plan.md');
    expect(dirOf('a/b/plan.md')).toBe('a/b');
    expect(sepOf('C:\\a')).toBe('\\');
    expect(sepOf('C:/a\\b')).toBe('/');
  });
  it('isAbsolutePath', () => {
    expect(['C:\\a', 'C:/a', '/a', '\\\\srv\\a'].every(isAbsolutePath)).toBe(true);
    expect(['~/wt/a', 'wt/a', '', undefined].some(isAbsolutePath)).toBe(false);
  });
});

describe('ticketKeyOf', () => {
  it('finds the first Jira key', () => {
    expect(ticketKeyOf('feat/CTX-4821-retry')).toBe('CTX-4821');
    expect(ticketKeyOf('main')).toBeUndefined();
  });
});
