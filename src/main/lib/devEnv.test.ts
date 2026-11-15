import { describe, expect, it } from 'vitest';
import { isDevOnlyEnvKey, stripDevEnv } from './devEnv';

describe('stripDevEnv', () => {
  const env = () => ({
    CORTEX_CLAUDE_BIN: '/x/fake-claude.mjs',
    CORTEX_JIRA_MOCK_SCRIPT: '/x/mock.mjs',
    CORTEX_SMOKE: '1',
    CORTEX_SMOKE_E2E: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    JIRA_MOCK_DB: '/x/db.json',
    CORTEX_USER_DATA: '/tmp/profile',
    CORTEX_JIRA_CLI: 'mock',
    CORTEX_AI_REVIEW_COMMENT: '/review',
    GH_TOKEN: 'secret',
  });

  it('keeps everything in development', () => {
    const e = env();
    expect(stripDevEnv(e, false)).toEqual([]);
    expect(e).toEqual(env());
  });

  it('drops the dev-only keys in a packaged build and keeps the rest', () => {
    const e: NodeJS.ProcessEnv = env();
    expect(stripDevEnv(e, true).sort()).toEqual([
      'CORTEX_AI_REVIEW_COMMENT',
      'CORTEX_CLAUDE_BIN',
      'CORTEX_JIRA_CLI',
      'CORTEX_JIRA_MOCK_SCRIPT',
      'CORTEX_SMOKE',
      'CORTEX_SMOKE_E2E',
      'ELECTRON_RENDERER_URL',
      'JIRA_MOCK_DB',
    ]);
    expect(e).toEqual({ CORTEX_USER_DATA: '/tmp/profile', GH_TOKEN: 'secret' });
  });

  it('matches by name', () => {
    expect(isDevOnlyEnvKey('JIRA_MOCK_SITE')).toBe(true);
    expect(isDevOnlyEnvKey('CORTEX_USER_DATA')).toBe(false);
    expect(isDevOnlyEnvKey('CORTEX_CLAUDE_BIN_X')).toBe(false);
  });
});
