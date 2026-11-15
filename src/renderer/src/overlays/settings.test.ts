import { describe, expect, it } from 'vitest';
import { UserConfigSchema } from '../../../shared/userConfig';
import { configFileInfo, settingsPatch, validRefresh } from './settings';

describe('settings form', () => {
  it('builds a config.json patch: blank model / effort / AI comment = null (back to the default)', () => {
    expect(settingsPatch({ model: ' ', permissionMode: 'acceptEdits', aiReviewComment: '', refreshSec: '90', soundOn: false })).toEqual({
      claude: { model: null, effort: null, permissionMode: 'acceptEdits' },
      github: { aiReviewComment: null },
      refresh: { intervalSec: 90 },
      ui: { sound: false, theme: 'system', animations: true },
    });
    expect(settingsPatch({ model: 'opus', modelCustom: '', effort: 'high', permissionMode: 'nonsense', aiReviewComment: '/review', refreshSec: '30' })).toMatchObject({
      claude: { model: 'opus', effort: 'high', permissionMode: 'default' },
      github: { aiReviewComment: '/review' },
    });
    expect(settingsPatch({ model: 'opus', modelCustom: 'claude-opus-5-5', refreshSec: '60' }).claude?.model).toBe('claude-opus-5-5');
    expect(settingsPatch({ refreshSec: '60', theme: 'dark', animations: false }).ui).toEqual({ sound: false, theme: 'dark', animations: false });
    expect(settingsPatch({ refreshSec: '60', theme: 'neon' }).ui?.theme).toBe('system');
  });
  it('validates the refresh interval', () => {
    expect(validRefresh('60')).toBeUndefined();
    expect(validRefresh('5')).toBeTruthy();
    expect(validRefresh('1.5')).toBeTruthy();
    expect(validRefresh('abc')).toBeTruthy();
  });
  it('the config accepts the CLI\'s "manual" mode and falls back on unknown ones', () => {
    expect(UserConfigSchema.parse({ claude: { permissionMode: 'manual' } }).claude.permissionMode).toBe('manual');
    expect(UserConfigSchema.parse({ claude: { permissionMode: 'yolo' } }).claude.permissionMode).toBe('default');
  });
  it('shows the config path and its problems', () => {
    expect(configFileInfo({ path: '/h/.cortex/config.json', problems: ['invalid value for "refresh.intervalSec", using the default'], config: UserConfigSchema.parse({}) })).toMatch(
      /config\.json · invalid value/,
    );
    expect(configFileInfo(undefined)).toMatch(/unknown/);
  });
});
