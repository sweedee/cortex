import { describe, expect, it } from 'vitest';
import { PrefsSchema } from '../domain/schemas';
import { settingsPatch, validRefresh } from './settings';

describe('settings form', () => {
  it('blank text unsets model and AI comment; refresh is a number', () => {
    expect(settingsPatch({ model: ' ', permissionMode: 'acceptEdits', aiReviewComment: '', refreshSec: '90' })).toEqual({ model: undefined, permissionMode: 'acceptEdits', aiReviewComment: undefined, refreshSec: 90 });
    expect(settingsPatch({ model: 'opus', permissionMode: 'nonsense', aiReviewComment: '/review', refreshSec: '30' })).toMatchObject({ model: 'opus', permissionMode: 'default', aiReviewComment: '/review' });
  });
  it('validates the refresh interval', () => {
    expect(validRefresh('60')).toBeUndefined();
    expect(validRefresh('5')).toBeTruthy();
    expect(validRefresh('1.5')).toBeTruthy();
    expect(validRefresh('abc')).toBeTruthy();
  });
  it('the stored prefs accept the CLI\'s "manual" mode and fall back on unknown ones', () => {
    const base = { desktopNotify: false, soundOn: true, colorBy: 'project', refreshSec: 60, sidebarWidth: 360 };
    expect(PrefsSchema.parse({ ...base, permissionMode: 'manual' }).permissionMode).toBe('manual');
    expect(PrefsSchema.parse({ ...base, permissionMode: 'yolo' }).permissionMode).toBe('default');
  });
});
