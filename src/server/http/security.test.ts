import { describe, expect, it } from 'vitest';
import { hostAllowed, isAuthenticated, makeToken, originAllowed, parseCookies, parseOrigins, tokenMatches } from './security';

const cfg = { port: 4317, token: 'a'.repeat(32), devOrigins: ['http://127.0.0.1:5173'] };

describe('security helpers', () => {
  it('tokens: random by default, a fixed one only when long enough; compared exactly', () => {
    expect(makeToken()).not.toBe(makeToken());
    expect(makeToken().length).toBeGreaterThanOrEqual(40);
    expect(makeToken('x'.repeat(16))).toBe('x'.repeat(16));
    expect(makeToken('short')).not.toBe('short');
    expect(tokenMatches(cfg.token, cfg.token)).toBe(true);
    expect(tokenMatches(cfg.token.slice(1), cfg.token)).toBe(false);
    expect(tokenMatches(`${cfg.token}a`, cfg.token)).toBe(false);
    expect(tokenMatches('', cfg.token)).toBe(false);
    expect(tokenMatches(undefined, cfg.token)).toBe(false);
  });

  it('cookie or bearer', () => {
    expect(isAuthenticated({ headers: { cookie: `x=1; cortex_token_4317=${cfg.token}` } }, cfg)).toBe(true);
    expect(isAuthenticated({ headers: { cookie: `cortex_token_9999=${cfg.token}` } }, cfg)).toBe(false);
    expect(isAuthenticated({ headers: { authorization: `Bearer ${cfg.token}` } }, cfg)).toBe(true);
    expect(isAuthenticated({ headers: { authorization: `Basic ${cfg.token}` } }, cfg)).toBe(false);
    expect(parseCookies('a=1; b = %41 ; bad').get('b')).toBe('A');
  });

  it('Host and Origin', () => {
    expect(hostAllowed('127.0.0.1:4317', cfg)).toBe(true);
    expect(hostAllowed('LOCALHOST:4317', cfg)).toBe(true);
    for (const h of [undefined, '127.0.0.1', '127.0.0.1:80', 'evil.example:4317', '127.0.0.1.nip.io:4317']) expect(hostAllowed(h, cfg), h).toBe(false);
    expect(originAllowed(undefined, cfg)).toBe(true);
    expect(originAllowed('http://127.0.0.1:4317', cfg)).toBe(true);
    expect(originAllowed('http://127.0.0.1:5173', cfg)).toBe(true);
    for (const o of ['null', 'http://127.0.0.1:4318', 'https://127.0.0.1:4317', 'http://evil.example']) expect(originAllowed(o, cfg), o).toBe(false);
    expect(parseOrigins('http://127.0.0.1:5173/, http://localhost:5173,https://evil.example,junk')).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
  });
});
