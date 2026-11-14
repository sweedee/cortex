import { describe, expect, it } from 'vitest';
import { deploymentFields, guessStage, mockStatus, STAGE_TONE, stageLabel } from './model';

describe('deployment model', () => {
  it('labels and tones stages', () => {
    expect(stageLabel({ stage: 'prod' })).toBe('prod');
    expect(stageLabel({ stage: 'custom', stageLabel: ' perf ' })).toBe('perf');
    expect(stageLabel({ stage: 'custom' })).toBe('custom');
    expect(STAGE_TONE.prod).toBe('critical');
    expect(STAGE_TONE.dev).toBe('neutral');
    expect(guessStage('https://app.dev.example.com')).toBe('dev');
    expect(guessStage('https://stage.example.com')).toBe('staging');
  });

  it('builds data from the form', () => {
    expect(deploymentFields({ url: 'dev.example.com', stage: 'dev', stageLabel: 'x' })).toEqual({ url: 'https://dev.example.com', stage: 'dev', stageLabel: undefined });
    expect(deploymentFields({ url: 'http://x.io', stage: 'custom', stageLabel: ' perf ' }).stageLabel).toBe('perf');
    expect(() => deploymentFields({ url: '', stage: 'dev', stageLabel: '' })).toThrow(/required/);
    expect(() => deploymentFields({ url: 'ftp://x', stage: 'dev', stageLabel: '' })).toThrow(/http/);
    expect(() => deploymentFields({ url: 'https://x', stage: 'custom', stageLabel: ' ' })).toThrow(/label/);
    expect(() => deploymentFields({ url: 'https://x', stage: 'nope', stageLabel: '' })).toThrow(/stage/);
  });

  it('mock status is deterministic per id, jitters only the response time', () => {
    const t = Date.UTC(2026, 10, 14, 12, 0, 0);
    const a = mockStatus('d-1', t);
    expect(mockStatus('d-1', t)).toEqual(a);
    const later = mockStatus('d-1', t + 15_000 * 7);
    expect({ ...later, responseMs: 0 }).toEqual({ ...a, responseMs: 0 });
    expect(['up', 'degraded', 'down']).toContain(a.health);
    expect(a.deployedAt).toBeLessThanOrEqual(t);
    expect(mockStatus('d-2', t).version).not.toBe('');
    expect(mockStatus('d-1', t, { health: 'down', version: '9.9.9' })).toMatchObject({ health: 'down', version: '9.9.9', responseMs: 0 });
  });
});
