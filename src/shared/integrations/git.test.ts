import { describe, expect, it } from 'vitest';
import { parseLog, parseNumstat, parseRemoteRepo, parseStatusV2, parseWorktreeList } from './git';

describe('git parsers', () => {
  it('parses worktree list --porcelain', () => {
    const out = [
      'worktree C:/src/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree C:/wt/CTX-1',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      'locked reason here',
      '',
      'worktree /bare',
      'bare',
      '',
    ].join('\n');
    expect(parseWorktreeList(out)).toEqual([
      { path: 'C:/src/repo', head: '1'.repeat(40), branch: 'main', bare: false, detached: false, locked: false, prunable: false },
      { path: 'C:/wt/CTX-1', head: '2'.repeat(40), branch: null, bare: false, detached: true, locked: true, prunable: false },
      { path: '/bare', head: '', branch: null, bare: true, detached: false, locked: false, prunable: false },
    ]);
  });

  it('parses status --porcelain=v2 --branch -z', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head feat/x',
      '# branch.upstream origin/feat/x',
      '# branch.ab +2 -3',
      '1 .M N... 100644 100644 100644 aaa aaa src/a b.ts',
      '2 R. N... 100644 100644 100644 bbb bbb R100 new.ts',
      'old.ts',
      'u UU N... 100644 100644 100644 100644 c1 c2 c3 conflict.ts',
      '? untracked.txt',
      '',
    ].join('\0');
    const s = parseStatusV2(out);
    expect(s).toMatchObject({ branch: 'feat/x', head: 'abc', upstream: 'origin/feat/x', ahead: 2, behind: 3, dirty: true });
    expect(s.files).toEqual([
      { path: 'src/a b.ts', index: '.', worktree: 'M', kind: 'changed' },
      { path: 'new.ts', origPath: 'old.ts', index: 'R', worktree: '.', kind: 'renamed' },
      { path: 'conflict.ts', index: 'U', worktree: 'U', kind: 'unmerged' },
      { path: 'untracked.txt', index: '?', worktree: '?', kind: 'untracked' },
    ]);
    expect(parseStatusV2('# branch.oid (initial)\0# branch.head (detached)\0')).toMatchObject({ head: null, branch: null, dirty: false });
  });

  it('parses numstat -z including renames and binaries', () => {
    const out = '3\t1\ta.ts\0' + '-\t-\timg.png\0' + '0\t0\t\0old.ts\0new.ts\0';
    expect(parseNumstat(out)).toEqual({
      files: [
        { path: 'a.ts', additions: 3, deletions: 1 },
        { path: 'img.png', additions: null, deletions: null },
        { path: 'new.ts', additions: 0, deletions: 0 },
      ],
      additions: 3,
      deletions: 1,
    });
  });

  it('parses the log format', () => {
    const rec = (s: string) => ['f'.repeat(40), 'fffffff', 'Ann', 'ann@x.io', '2026-11-13T10:00:00+01:00', s].join('\x1f') + '\x1e';
    expect(parseLog(rec('first') + '\n' + rec('second | with pipes'))).toEqual([
      { sha: 'f'.repeat(40), short: 'fffffff', author: 'Ann', email: 'ann@x.io', date: '2026-11-13T10:00:00+01:00', subject: 'first' },
      expect.objectContaining({ subject: 'second | with pipes' }),
    ]);
    expect(parseLog('')).toEqual([]);
  });

  it.each([
    ['https://github.com/sweedee/cortex.git', 'sweedee/cortex'],
    ['https://github.com/sweedee/cortex', 'sweedee/cortex'],
    ['https://user@github.com/o/r.git/', 'o/r'],
    ['git@github.com:ctx-observability/ingest-gateway.git', 'ctx-observability/ingest-gateway'],
    ['ssh://git@github.example.com:2222/o/r.git', 'o/r'],
    ['C:/local/path', null],
    ['', null],
  ])('remote %s → %s', (url, repo) => expect(parseRemoteRepo(url)).toBe(repo));
});
