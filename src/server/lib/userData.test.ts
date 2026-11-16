import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveUserData } from './userData';

describe('user data location', () => {
  it('defaults to ~/.cortex; CORTEX_USER_DATA overrides it', () => {
    expect(resolveUserData({}, 'C:/Users/me')).toBe(join('C:/Users/me', '.cortex'));
    expect(resolveUserData({ CORTEX_USER_DATA: 'C:/tmp/p' }, 'C:/Users/me')).toBe('C:/tmp/p');
  });
});
