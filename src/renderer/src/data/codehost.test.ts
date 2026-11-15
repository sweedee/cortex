import { describe, expect, it } from 'vitest';
import { ProjectDataSchema } from '../domain/schemas';
import { codeHost } from './codehost';

describe('code host dispatch', () => {
  it('defaults to GitHub and builds links through the configured host', () => {
    expect(codeHost().id).toBe('github');
    expect(codeHost('github').prUrl('o/r', 3)).toMatch(/^https:\/\/[^/]+\/o\/r\/pull\/3$/);
    expect(codeHost(undefined).runUrl('o/r', 9)).toMatch(/\/o\/r\/actions\/runs\/9$/);
  });

  it('provider is optional and an unknown one is dropped (no migration needed)', () => {
    expect(ProjectDataSchema.parse({ repo: 'o/r', defaultBranch: 'main' }).provider).toBeUndefined();
    expect(ProjectDataSchema.parse({ repo: 'o/r', defaultBranch: 'main', provider: 'github' }).provider).toBe('github');
    expect(ProjectDataSchema.parse({ repo: 'o/r', defaultBranch: 'main', provider: 'gitlab' }).provider).toBeUndefined();
  });
});
