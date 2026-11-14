import { describe, expect, it } from 'vitest';
import type { BuildData, Item } from '../domain';
import { makeItem } from '../store';
import { jobsFor } from './refresher';

const build = (id: string, d: Partial<BuildData>): Item =>
  makeItem({ id, kind: 'build', handle: id, title: id, data: { repo: 'octo/repo', name: 'ci', url: 'https://ci/x', state: 'in_progress', branch: 'feat/a', ...d } });

describe('refresher jobs for builds', () => {
  it('Actions runs poll gh run view (fast), other CI polls the PR checks once per PR', () => {
    const jobs = jobsFor([
      build('b-run', { runId: '123' }),
      build('b-jenkins-1', { prNumber: 7, name: 'jenkins/a' }),
      build('b-jenkins-2', { prNumber: 7, name: 'jenkins/b' }),
      build('b-done', { runId: '5', state: 'completed', conclusion: 'success' }),
      build('b-demo', { runId: '9', repo: 'unknown/x' }),
      build('b-orphan', {}),
      { ...build('b-archived', { runId: '6' }), archived: true },
    ]);
    expect(jobs.map((j) => [j.id, j.group, j.fast])).toEqual([
      ['b-run', 'gh:octo/repo', true],
      ['checks:octo/repo#7', 'gh:octo/repo', true],
    ]);
  });
});
