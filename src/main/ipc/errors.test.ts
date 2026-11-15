import { describe, expect, it } from 'vitest';
import { decodeIpcError } from '../../shared/ipcError';
import { CliMissingError } from '../lib/exec';
import { PathNotAllowedError, Roots } from '../lib/pathPolicy';
import { InvalidRequestError, parseRequest } from '../lib/validate';
import { CliError, ParseError, parseJson } from '../services/cli';
import { ghChecksSchema } from '../services/schemas';
import { ipcError, toIpcError } from './errors';

const result = { code: 1, stdout: '', stderr: 'bad things', timedOut: false };

describe('toIpcError / ipcError', () => {
  it('maps a failed exit', () => {
    const p = decodeIpcError(ipcError(new CliError('gh', ['pr', 'view'], { ...result, code: 4 })));
    expect(p).toMatchObject({ code: 'EXIT', exitCode: 4, stderr: 'bad things', message: 'gh pr view: bad things' });
  });
  it('maps a timeout', () => {
    expect(toIpcError(new CliError('git', ['fetch'], { ...result, code: null, timedOut: true }))).toMatchObject({ code: 'TIMEOUT' });
  });
  it('maps a missing CLI', () => {
    expect(toIpcError(new CliMissingError('acli', 'spawn acli ENOENT'))).toMatchObject({ code: 'CLI_MISSING', message: 'Could not run acli: spawn acli ENOENT' });
  });
  it('maps a bad request to VALIDATION with issues', () => {
    let err: unknown;
    try {
      parseRequest('proc:stop', { id: 5 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InvalidRequestError);
    const p = toIpcError(err);
    expect(p.code).toBe('VALIDATION');
    expect(p.issues?.[0].path).toBe('id');
  });
  it('maps path policy refusals to FORBIDDEN', () => {
    expect(toIpcError(new PathNotAllowedError('cwd not allowed: /x'))).toMatchObject({ code: 'FORBIDDEN' });
    const roots = new Roots({ platform: 'linux', home: '/home/me', userData: '/home/me/.cortex' } as never);
    expect(() => roots.check('/definitely/elsewhere')).toThrow(PathNotAllowedError);
  });
  it('maps unparsable CLI output to PARSE', () => {
    let err: unknown;
    try {
      parseJson('{"not":"an array"}', 'gh pr checks', ghChecksSchema);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseError);
    expect(toIpcError(err).code).toBe('PARSE');
  });
  it('maps everything else to UNKNOWN', () => {
    expect(toIpcError(new Error('x'))).toEqual({ code: 'UNKNOWN', message: 'x' });
    expect(toIpcError('str')).toEqual({ code: 'UNKNOWN', message: 'str' });
  });
});
