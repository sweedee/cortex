import { describe, expect, it } from 'vitest';
import { errorText } from './task';

describe('errorText', () => {
  it('strips the IPC wrapper and error class names', () => {
    expect(errorText(new Error("Error invoking remote method 'gh:prCreate': CliError: gh pr create: error connecting to x"))).toBe('gh pr create: error connecting to x');
    expect(errorText(new Error("Error invoking remote method 'git:push': Error: boom"))).toBe('boom');
    expect(errorText('plain')).toBe('plain');
  });
});
