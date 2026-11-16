import { describe, expect, it } from 'vitest';
import { crumbs, joinPath, matchesFilters, visibleEntries } from './pickerModel';

describe('picker model', () => {
  it('matches extensions case-insensitively, with or without a dot', () => {
    const f = [{ name: 'Markdown', extensions: ['md', '.MDX'] }];
    expect(matchesFilters('a.md', f)).toBe(true);
    expect(matchesFilters('a.MDX', f)).toBe(true);
    expect(matchesFilters('a.txt', f)).toBe(false);
    expect(matchesFilters('md', f)).toBe(false);
    expect(matchesFilters('a.txt')).toBe(true);
    expect(matchesFilters('a.txt', [{ name: 'All', extensions: ['*'] }])).toBe(true);
  });

  it('lists folders always, files only for file picks', () => {
    const entries = [
      { name: 'src', dir: true },
      { name: 'a.json', dir: false },
      { name: 'b.txt', dir: false },
    ];
    expect(visibleEntries(entries, 'dir').map((e) => e.name)).toEqual(['src']);
    expect(visibleEntries(entries, 'file').map((e) => e.name)).toEqual(['src', 'a.json', 'b.txt']);
    expect(visibleEntries(entries, 'file', [{ name: 'JSON', extensions: ['json'] }]).map((e) => e.name)).toEqual(['src', 'a.json']);
  });

  it('joins and splits paths of either platform', () => {
    expect(joinPath('/', 'a')).toBe('/a');
    expect(joinPath('/a', 'b')).toBe('/a/b');
    expect(joinPath('C:\\a', 'b')).toBe('C:\\a\\b');
    expect(crumbs('/')).toEqual([{ label: '/', path: '/' }]);
    expect(crumbs('/home/u')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'u', path: '/home/u' },
    ]);
    expect(crumbs('C:\\Users\\u').map((c) => c.path)).toEqual(['C:\\', 'C:\\Users', 'C:\\Users\\u']);
  });
});
