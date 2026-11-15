import { describe, expect, it } from 'vitest';
import { isHttpUrl, permissionAllowed, sameOrigin, webviewRefusal } from './urlPolicy';

describe('isHttpUrl', () => {
  it('parses instead of pattern matching', () => {
    expect(isHttpUrl('https://github.com/a/b')).toBe(true);
    expect(isHttpUrl('HTTP://localhost:5173/')).toBe(true);
    for (const u of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'data:text/html,hi', 'about:blank', 'ms-settings:', 'https//nope', '', undefined]) {
      expect(isHttpUrl(u), String(u)).toBe(false);
    }
  });
});

describe('sameOrigin', () => {
  it('compares scheme, host and port', () => {
    expect(sameOrigin('http://localhost:5173/x?y', 'http://localhost:5173')).toBe(true);
    expect(sameOrigin('http://localhost:5173.evil.com/', 'http://localhost:5173')).toBe(false);
    expect(sameOrigin('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(sameOrigin('https://localhost:5173/', 'http://localhost:5173')).toBe(false);
    expect(sameOrigin('http://localhost:5173/', undefined)).toBe(false);
    expect(sameOrigin('file:///a', 'file:///a')).toBe(false);
  });
});

describe('webviewRefusal', () => {
  it('needs an http(s) src and a known partition', () => {
    expect(webviewRefusal('https://github.com/o/r/pull/1', 'persist:github')).toBeUndefined();
    expect(webviewRefusal('http://localhost:3000/', 'persist:apps')).toBeUndefined();
    expect(webviewRefusal('file:///C:/Users/me/.ssh/id_rsa', 'persist:github')).toMatch(/http/);
    expect(webviewRefusal(undefined, 'persist:github')).toMatch(/http/);
    expect(webviewRefusal('https://github.com', undefined)).toMatch(/partition/);
    expect(webviewRefusal('https://github.com', 'persist:other')).toMatch(/partition/);
    expect(webviewRefusal('https://github.com', '')).toMatch(/partition/);
  });
});

describe('permissionAllowed', () => {
  it('denies everything but a sanitized clipboard write', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'openExternal', 'clipboard-read', 'fullscreen', 'pointerLock']) {
      expect(permissionAllowed(p), p).toBe(false);
    }
    expect(permissionAllowed('clipboard-sanitized-write')).toBe(true);
  });
});
