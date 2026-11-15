import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_CONFIG, parseUserConfig } from '../../../shared/userConfig';
import { combinePatches, configPatchOf, mirrorOfConfig, userConfig } from './config';

describe('config mirror', () => {
  const base = mirrorOfConfig(DEFAULT_USER_CONFIG);

  it('maps config.json to the store settings', () => {
    expect(base).toEqual({ model: undefined, effort: undefined, permissionMode: 'default', aiReviewComment: '@claude review', refreshSec: 60, desktopNotify: false, soundOn: true });
    expect(mirrorOfConfig(parseUserConfig({ claude: { model: 'opus', effort: 'max' }, ui: { notifications: true } }))).toMatchObject({ model: 'opus', effort: 'max', desktopNotify: true });
  });

  it('turns store changes into a patch (unset model / effort → null)', () => {
    expect(configPatchOf(base, base)).toBeUndefined();
    expect(configPatchOf(base, { ...base, model: 'opus', soundOn: false })).toEqual({ claude: { model: 'opus' }, ui: { sound: false } });
    expect(configPatchOf({ ...base, model: 'opus', effort: 'high' }, base)).toEqual({ claude: { model: null, effort: null } });
    expect(configPatchOf(base, { ...base, refreshSec: 30, aiReviewComment: '/r', permissionMode: 'plan' })).toEqual({
      claude: { permissionMode: 'plan' },
      github: { aiReviewComment: '/r' },
      refresh: { intervalSec: 30 },
    });
  });

  it('coalesces patches without losing nulls', () => {
    expect(combinePatches({ claude: { model: null }, ui: { sound: true } }, { claude: { effort: 'low' }, ui: { sound: false } })).toEqual({
      claude: { model: null, effort: 'low' },
      ui: { sound: false },
    });
  });

  it('reads the defaults before config.json is loaded', () => {
    expect(userConfig()).toEqual(DEFAULT_USER_CONFIG);
  });
});
